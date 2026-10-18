// Small unit checks for the security-sensitive helpers, the agent's keyword routing and the
// data-only tools (on the in-memory seed). No test framework: plain asserts.
// Usage: npm run test:unit   (exit code 1 on the first failed check)

import assert from "node:assert/strict";
import { keywordToolFor } from "../lib/agent/agent";
import { canSendToken } from "../lib/agent/mcpClient";
import { addDays, periodRange, todayISO } from "../lib/dates";
import { allowRequest, MAX_TRACKED_KEYS } from "../lib/rateLimit";
import { searchDocuments } from "../lib/search";
import { limitSentences } from "../lib/speech";
import { getStorage, HOUSEHOLD_ID } from "../lib/storage";
import { buildSeedDocuments } from "../lib/storage/seed";
import { runCheckWarranty } from "../lib/tools/checkWarranty";
import { compareIssuerBills, isNoticeablyHigher, runCompareBills } from "../lib/tools/compareBills";
import { runListDeadlines } from "../lib/tools/listDeadlines";
import { resolveDocument } from "../lib/tools/resolveDocument";
import { runWeeklyBrief } from "../lib/tools/weeklyBrief";
import type { Document } from "../lib/types";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

function withEnv(values: Record<string, string | undefined>, fn: () => void) {
  const saved = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  try {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fn();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const NO_VERCEL = {
  VERCEL_URL: undefined,
  VERCEL_BRANCH_URL: undefined,
  VERCEL_PROJECT_PRODUCTION_URL: undefined,
  MCP_URL: undefined,
};

// canSendToken(target, incoming request URL)
check("localhost, 127.0.0.1 and [::1] get the token when the host matches", () => {
  withEnv(NO_VERCEL, () => {
    assert.equal(canSendToken("http://localhost:3000/api/mcp", "http://localhost:3000/api/chat"), true);
    assert.equal(canSendToken("http://127.0.0.1:3100/api/mcp", "http://127.0.0.1:3100/api/chat"), true);
    assert.equal(canSendToken("http://[::1]:3000/api/mcp", "http://[::1]:3000/api/chat"), true);
  });
});

check("the deployment's own Vercel hosts get the token", () => {
  withEnv(
    {
      ...NO_VERCEL,
      VERCEL_URL: "duly-abc123-team.vercel.app",
      VERCEL_BRANCH_URL: "https://duly-git-feat-team.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "duly.vercel.app",
    },
    () => {
      for (const host of ["duly-abc123-team.vercel.app", "duly-git-feat-team.vercel.app", "duly.vercel.app"]) {
        assert.equal(canSendToken(`https://${host}/api/mcp`, `https://${host}/api/chat`), true, host);
      }
    },
  );
});

check("another *.vercel.app host does not get the token", () => {
  withEnv({ ...NO_VERCEL, VERCEL_URL: "duly.vercel.app" }, () => {
    const other = "https://someone-else.vercel.app";
    assert.equal(canSendToken(`${other}/api/mcp`, `${other}/api/chat`), false);
  });
});

check("a target host different from the request host does not get the token", () => {
  withEnv({ ...NO_VERCEL, VERCEL_URL: "duly.vercel.app" }, () => {
    assert.equal(canSendToken("https://duly.vercel.app/api/mcp", "http://localhost:3000/api/chat"), false);
    assert.equal(canSendToken("http://localhost:3100/api/mcp", "http://localhost:3000/api/chat"), false);
  });
});

check("MCP_URL no longer extends the allowlist", () => {
  withEnv({ ...NO_VERCEL, MCP_URL: "https://mcp.example.com/api/mcp" }, () => {
    assert.equal(canSendToken("https://mcp.example.com/api/mcp", "https://mcp.example.com/api/chat"), false);
  });
});

// Rate limiter
check("a request over the limit is refused", () => {
  assert.equal(allowRequest("unit-limit", "1.1.1.1", 2), true);
  assert.equal(allowRequest("unit-limit", "1.1.1.1", 2), true);
  assert.equal(allowRequest("unit-limit", "1.1.1.1", 2), false);
});

check("the tracked keys never exceed the cap, and the oldest are evicted first", () => {
  // Fill past the cap with distinct keys, all inside the same minute (none is expired).
  for (let i = 0; i < MAX_TRACKED_KEYS + 500; i++) allowRequest("unit-flood", `ip-${i}`, 1);
  // The newest key is still tracked (a second hit is refused with limit 1)...
  assert.equal(allowRequest("unit-flood", `ip-${MAX_TRACKED_KEYS + 499}`, 1), false);
  // ...and the oldest was evicted (it starts counting from zero again).
  assert.equal(allowRequest("unit-flood", "ip-0", 1), true);
});

// Keyword fallback of the agent (used when Nova answers in text instead of calling a tool).
check("keyword fallback: existing demo questions keep their tools", () => {
  const expected: [string, string][] = [
    ["What do I need to pay this month?", "list_deadlines"],
    ["What's due this week?", "list_deadlines"],
    ["Is my dishwasher still under warranty?", "check_warranty"],
    ["Which of my warranties are still active?", "check_warranty"],
    ["Explain the parking fine letter.", "explain_document"],
    ["What does the parking notice mean? What happens if I ignore it?", "explain_document"],
    ["Write a reply to Brightwave Energy disputing my electricity bill.", "draft_reply"],
    ["Make it firmer.", "draft_reply"],
  ];
  for (const [message, tool] of expected) assert.equal(keywordToolFor(message), tool, message);
});

check("keyword fallback: new questions go to compare_bills and weekly_brief", () => {
  assert.equal(keywordToolFor("Is my Brightwave bill higher than usual?"), "compare_bills");
  assert.equal(keywordToolFor("Is my fridge still under warranty?"), "check_warranty");
  assert.equal(keywordToolFor("Give me my weekly brief."), "weekly_brief");
  assert.equal(keywordToolFor("Summarize my week"), "weekly_brief");
  assert.equal(keywordToolFor("Can I get a summary of the week?"), "weekly_brief");
});

check('keyword fallback: "summarize my insurance letter" is an explanation, not a brief', () => {
  assert.notEqual(keywordToolFor("Can you summarize my insurance letter?"), "weekly_brief");
  assert.equal(keywordToolFor("Can you summarize my insurance letter?"), "explain_document");
  assert.equal(keywordToolFor("Give me a summary of this letter."), "explain_document");
});

// A fake bill for the threshold checks.
function bill(id: string, amount: number, daysAgo: number): Document {
  const today = todayISO();
  return {
    id,
    householdId: "unit",
    type: "bill",
    title: `Test bill ${id}`,
    issuer: "Test Power",
    issueDate: addDays(today, -daysAgo),
    amount,
    currency: "USD",
    deadlines: [],
    summary: "",
    actionItems: [],
    rawText: "",
    createdAt: `${today}T09:00:00.000Z`,
  };
}

check("weekly_brief threshold: at least 15% above the average of earlier bills", () => {
  // Average of the earlier bills: (90 + 110) / 2 = 100.
  const earlier = [bill("b", 110, 30), bill("c", 90, 60)];
  assert.equal(isNoticeablyHigher(compareIssuerBills([bill("a", 115, 0), ...earlier])), true);
  assert.equal(isNoticeablyHigher(compareIssuerBills([bill("a", 114.99, 0), ...earlier])), false);
  // Rounded to one decimal, 114.99 shows as 15%: the rule uses the exact amounts.
  assert.equal(compareIssuerBills([bill("a", 114.99, 0), ...earlier]).percentVsAverage, 15);
  // A single bill has nothing to compare with.
  assert.equal(isNoticeablyHigher(compareIssuerBills([bill("a", 500, 0)])), false);
});

async function checkAsync(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

const hasPrev = (ids: string[]) => ids.some((id) => id.includes("-prev-"));

// Tools on the in-memory seed (dates relative to today).
async function storageChecks() {
  process.env.STORAGE = "memory";

  await checkAsync('search and lookups: "Brightwave bill" is the latest bill, never an earlier one', async () => {
    const seed = buildSeedDocuments(todayISO());
    assert.equal(searchDocuments(seed, "Brightwave bill")[0].id, "doc-brightwave-bill");
    assert.equal(searchDocuments(seed, "electricity bill")[0].id, "doc-brightwave-bill");
    // Storage order must not matter (earlier bills first here).
    assert.equal(searchDocuments([...seed].reverse(), "Brightwave bill")[0].id, "doc-brightwave-bill");
    assert.equal(searchDocuments([...seed].reverse(), "Brightwave Energy")[0].id, "doc-brightwave-bill");
    assert.equal((await resolveDocument({ query: "Brightwave bill" })).id, "doc-brightwave-bill");
    assert.equal((await resolveDocument({ issuer: "Brightwave Energy" })).id, "doc-brightwave-bill");
    assert.equal((await resolveDocument({ issuer: "Brightwave Energy", query: "electricity bill" })).id, "doc-brightwave-bill");
    // explain_document and the agent's fallback search with the whole question.
    assert.equal((await resolveDocument({ query: "Explain my Brightwave electricity bill." })).id, "doc-brightwave-bill");
    assert.equal(
      (await resolveDocument({ query: "Write a reply to Brightwave Energy disputing my electricity bill." })).id,
      "doc-brightwave-bill",
    );
  });

  await checkAsync("compare_bills: Brightwave vs previous and usual", async () => {
    const { structuredContent, text } = await runCompareBills({ query: "Is my Brightwave bill higher than usual?" });
    const c = structuredContent.comparison!;
    assert.equal(c.latest.documentId, "doc-brightwave-bill");
    assert.deepEqual(
      c.previous.map((b) => b.amount),
      [70.1, 68.4],
    );
    assert.equal(c.previousAmount, 70.1);
    assert.equal(c.differenceVsPrevious, 14.1);
    assert.equal(c.percentVsPrevious, 20.1);
    assert.equal(c.averageAmount, 69.25);
    assert.equal(c.percentVsAverage, 21.6);
    assert.equal(c.trend, "higher");
    assert.match(text, /^Your Brightwave Energy bill is \$84\.20, about 22% higher than your usual \$69\./);
  });

  await checkAsync("list_deadlines: earlier bills are never upcoming deadlines or payments", async () => {
    const month = await runListDeadlines({ payable: true, ...periodRange("month") });
    const next30 = await runListDeadlines({});
    assert.equal(hasPrev(month.structuredContent.deadlines.map((d) => d.documentId)), false);
    assert.equal(hasPrev(next30.structuredContent.deadlines.map((d) => d.documentId)), false);
    // Warranty ends carry no amount, so they are never counted as payments.
    assert.equal(month.structuredContent.deadlines.some((d) => d.kind === "warranty_ends"), false);
  });

  await checkAsync('check_warranty says "expired" and "expiring soon" clearly', async () => {
    const fridge = await runCheckWarranty({ product: "fridge" });
    assert.equal(fridge.structuredContent.warranty?.status, "expiring_soon");
    assert.match(fridge.text, /expiring soon/);
    const washer = await runCheckWarranty({ product: "washing machine" });
    assert.equal(washer.structuredContent.warranty?.status, "expired");
    assert.match(washer.text, /expired on/);
    const all = await runCheckWarranty({});
    assert.match(all.text, /1 expiring soon, 1 expired/);
    assert.match(all.text, /fridge warranty is expiring soon/);
    assert.match(all.text, /washing machine warranty expired/);
  });

  await checkAsync("weekly_brief: renewals, warranties, higher bills, max 3 sentences", async () => {
    const { text, structuredContent: brief } = await runWeeklyBrief({});
    assert.equal(brief.days, 7);
    assert.deepEqual(
      brief.renewals.map((r) => r.issuer),
      ["PeakFit"],
    );
    // PeakFit's renewal and cancel-by date are only listed as a renewal.
    assert.equal(brief.deadlines.some((d) => d.issuer === "PeakFit"), false);
    assert.deepEqual(
      brief.warrantiesEndingSoon.map((w) => w.product),
      ["fridge"],
    );
    assert.deepEqual(
      brief.higherBills.map((c) => c.issuer),
      ["Brightwave Energy"],
    );
    assert.equal(hasPrev(brief.deadlines.map((d) => d.documentId)), false);
    assert.equal(limitSentences(text, 99), limitSentences(text, 3), "more than 3 sentences");
    assert.match(text, /^In the next 7 days: cancel PeakFit/);
  });

  // Last: it saves a document in the shared in-memory store.
  await checkAsync('"water bill" is the newest Riverside bill, and the uploaded one once saved', async () => {
    assert.equal((await resolveDocument({ query: "water bill" })).id, "doc-riverside-water-prev-1");
    const uploaded: Document = {
      ...bill("doc-unit-riverside-upload", 56.75, 0),
      householdId: HOUSEHOLD_ID,
      title: "Riverside Water Company water bill (SAMPLE)",
      issuer: "Riverside Water Company",
      createdAt: new Date().toISOString(),
    };
    await getStorage().saveDocument(uploaded);
    assert.equal((await resolveDocument({ query: "water bill" })).id, uploaded.id);
    assert.equal((await resolveDocument({ issuer: "Riverside Water Company" })).id, uploaded.id);
    const docs = await getStorage().listDocuments(HOUSEHOLD_ID);
    assert.equal(searchDocuments(docs, "water bill")[0].id, uploaded.id);
    const water = await runCompareBills({ query: "water bill" });
    assert.equal(water.structuredContent.comparison?.latest.documentId, uploaded.id);
    assert.equal(water.structuredContent.comparison?.trend, "about_the_same");
  });

  // Also saves into the shared store: a newer bill whose extraction missed the amount.
  await checkAsync("a newer Riverside bill without amount still wins over the earlier bills", async () => {
    const withoutAmount: Document = { ...bill("doc-unit-riverside-no-amount", 0, 0), amount: undefined };
    const noAmount: Document = {
      ...withoutAmount,
      householdId: HOUSEHOLD_ID,
      title: "Riverside Water Company water bill (no amount)",
      issuer: "Riverside Water Company",
      createdAt: new Date(Date.now() + 60_000).toISOString(),
    };
    await getStorage().saveDocument(noAmount);
    const docs = await getStorage().listDocuments(HOUSEHOLD_ID);
    const first = searchDocuments(docs, "water bill")[0];
    assert.equal(first.id, noAmount.id);
    assert.equal(hasPrev([first.id]), false);
    assert.equal((await resolveDocument({ query: "water bill" })).id, noAmount.id);
    assert.equal((await resolveDocument({ issuer: "Riverside Water Company" })).id, noAmount.id);
    // Amounts are still compared between bills that have one.
    const water = await runCompareBills({ query: "water bill" });
    assert.notEqual(water.structuredContent.comparison?.latest.documentId, noAmount.id);
  });
}

storageChecks()
  .then(() => console.log(`\n${passed} checks passed.`))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
