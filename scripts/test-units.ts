// Small unit checks for the security-sensitive helpers, the agent's keyword routing and the
// data-only tools (on the in-memory seed). No test framework: plain asserts.
// Usage: npm run test:unit   (exit code 1 on the first failed check)

import assert from "node:assert/strict";
import { keywordToolFor } from "../lib/agent/agent";
import { canSendToken } from "../lib/agent/mcpClient";
import { addDays, periodRange, todayISO } from "../lib/dates";
import { forbiddenHostResponse } from "../lib/hosts";
import { allowRequest, MAX_TRACKED_KEYS } from "../lib/rateLimit";
import { searchDocuments } from "../lib/search";
import { limitSentences } from "../lib/speech";
import { getStorage, HOUSEHOLD_ID } from "../lib/storage";
import { buildSeedDocuments } from "../lib/storage/seed";
import { runCheckWarranty } from "../lib/tools/checkWarranty";
import { fromItem, toItem } from "../lib/storage/aws";
import { compareIssuerBills, isNoticeablyHigher, runCompareBills, usageSentence } from "../lib/tools/compareBills";
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

check("MCP_ALLOWED_HOSTS does not extend the token allowlist", () => {
  withEnv({ ...NO_VERCEL, MCP_ALLOWED_HOSTS: "duly-home.vercel.app" }, () => {
    const host = "https://duly-home.vercel.app";
    assert.equal(canSendToken(`${host}/api/mcp`, `${host}/api/chat`), false);
  });
});

// Host check on /api/mcp: forbiddenHostResponse(req) is undefined when the host is allowed.
const NO_HOSTS = { ...NO_VERCEL, MCP_ALLOWED_HOSTS: undefined };

function mcpRequest(host?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (host !== undefined) headers.set("host", host);
  return new Request("http://localhost/api/mcp", { method: "POST", headers, body: "{}" });
}

function hostAllowed(host?: string): boolean {
  return forbiddenHostResponse(mcpRequest(host)) === undefined;
}

check("Host check: localhost, 127.0.0.1 and [::1] pass with and without port", () => {
  withEnv(NO_HOSTS, () => {
    for (const host of ["localhost", "localhost:3000", "127.0.0.1", "127.0.0.1:3100", "[::1]", "[::1]:3000"]) {
      assert.equal(hostAllowed(host), true, host);
    }
  });
});

check("Host check: the deployment's preview and production hosts pass", () => {
  withEnv(
    {
      ...NO_HOSTS,
      VERCEL_URL: "duly-abc123-team.vercel.app",
      VERCEL_BRANCH_URL: "duly-git-fix-team.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "duly.vercel.app",
    },
    () => {
      for (const host of ["duly-abc123-team.vercel.app", "duly-git-fix-team.vercel.app", "duly.vercel.app:443"]) {
        assert.equal(hostAllowed(host), true, host);
      }
    },
  );
});

check("Host check: MCP_ALLOWED_HOSTS adds custom domains and LAN IPs", () => {
  withEnv({ ...NO_HOSTS, MCP_ALLOWED_HOSTS: " duly-home.vercel.app , https://duly.example.com/ ,192.168.1.20:3000," }, () => {
    for (const host of ["duly-home.vercel.app", "duly.example.com", "192.168.1.20:3000", "192.168.1.20"]) {
      assert.equal(hostAllowed(host), true, host);
    }
  });
});

check("Host check: uppercase and padded hosts pass", () => {
  withEnv({ ...NO_HOSTS, MCP_ALLOWED_HOSTS: "duly-home.vercel.app" }, () => {
    assert.equal(hostAllowed("Duly-Home.vercel.app"), true);
    assert.equal(hostAllowed(" LOCALHOST:3000 "), true);
  });
});

check("Host check: a foreign host gets 403 and the body is not read", () => {
  withEnv({ ...NO_HOSTS, VERCEL_URL: "duly.vercel.app" }, () => {
    for (const host of ["evil.example", "someone-else.vercel.app", "evil.com@localhost", "localhost/x", "localhost.evil.example"]) {
      const req = mcpRequest(host);
      const response = forbiddenHostResponse(req);
      assert.equal(response?.status, 403, host);
      assert.equal(req.bodyUsed, false, host);
    }
  });
});

check("Host check: a missing Host gets 403", () => {
  withEnv(NO_HOSTS, () => {
    assert.equal(forbiddenHostResponse(mcpRequest())?.status, 403);
    assert.equal(forbiddenHostResponse(mcpRequest(""))?.status, 403);
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

// A fake bill that states its usage.
function usageBill(id: string, amount: number, daysAgo: number, quantity: number, unit = "kWh"): Document {
  return { ...bill(id, amount, daysAgo), usage: { quantity, unit } };
}

check("compare_bills usage: percentages vs the average of the earlier bills", () => {
  // Earlier: 100 kWh for $100 and 140 kWh for $70 → usual 120 kWh, usual price (1 + 0.5) / 2 = $0.75.
  const earlier = [usageBill("b", 100, 30, 100), usageBill("c", 70, 60, 140)];
  const c = compareIssuerBills([usageBill("a", 120, 0, 150), ...earlier]);
  assert.equal(c.usageUnit, "kWh");
  assert.equal(c.usageQuantity, 150);
  assert.equal(c.usageBillsCompared, 2);
  assert.equal(c.averageUsage, 120);
  assert.equal(c.usagePercentVsAverage, 25);
  assert.equal(c.usageTrend, "higher");
  assert.equal(c.unitPrice, 0.8);
  assert.equal(c.averageUnitPrice, 0.75);
  assert.equal(c.unitPricePercentVsAverage, 6.7);
  assert.equal(c.unitPriceTrend, "higher");
  assert.equal(usageSentence(c), "You used about 25% more electricity than usual, and the price per kWh is about 7% higher.");
});

check('compare_bills usage: "about the same" means a change under 5%', () => {
  const earlier = [usageBill("b", 100, 30, 100), usageBill("c", 100, 60, 100)];
  const same = compareIssuerBills([usageBill("a", 104.99, 0, 104.99), ...earlier]);
  assert.equal(same.usageTrend, "about_the_same");
  assert.equal(same.unitPriceTrend, "about_the_same");
  assert.equal(usageSentence(same), "You used about the same amount of electricity as usual, at about the same price per kWh.");
  const moreUsed = compareIssuerBills([usageBill("a", 105, 0, 105), ...earlier]);
  assert.equal(moreUsed.usageTrend, "higher");
  assert.equal(moreUsed.unitPriceTrend, "about_the_same");
  assert.equal(usageSentence(moreUsed), "You used about 5% more electricity than usual, at about the same price per kWh.");
  const pricier = compareIssuerBills([usageBill("a", 115, 0, 100), ...earlier]);
  assert.equal(pricier.usageTrend, "about_the_same");
  assert.equal(pricier.unitPriceTrend, "higher");
  assert.equal(usageSentence(pricier), "You used about the same amount of electricity as usual, but the price per kWh is about 15% higher.");
});

check("compare_bills usage: water in gallons, one earlier bill is \"last time\"", () => {
  const c = compareIssuerBills([usageBill("a", 45, 0, 5000, "gallons"), usageBill("b", 50, 30, 5000, "gallons")]);
  assert.equal(usageSentence(c), "You used about the same amount of water as last time, but the price per gallon is about 10% lower.");
});

check("compare_bills usage: missing usage behaves exactly as before", () => {
  const plain = compareIssuerBills([bill("a", 120, 0), bill("b", 100, 30)]);
  const latestWithout = compareIssuerBills([bill("a", 120, 0), usageBill("b", 100, 30, 100)]);
  const earlierWithout = compareIssuerBills([usageBill("a", 120, 0, 100), bill("b", 100, 30)]);
  for (const c of [latestWithout, earlierWithout]) {
    assert.deepEqual(c, plain);
    assert.equal(usageSentence(c), "");
  }
  // Zero usage can't give a price per unit.
  assert.equal(compareIssuerBills([usageBill("a", 120, 0, 0), usageBill("b", 100, 30, 100)]).usageUnit, undefined);
});

check("compare_bills usage: only earlier bills in the same unit count", () => {
  const plain = compareIssuerBills([bill("a", 120, 0), bill("b", 100, 30)]);
  const otherUnit = compareIssuerBills([usageBill("a", 120, 0, 100, "kWh"), usageBill("b", 100, 30, 10, "therms")]);
  assert.deepEqual(otherUnit, plain);
  assert.equal(usageSentence(otherUnit), "");
  // "KWH" is "kWh"; the therms bill is left out of the averages (but not out of the amounts).
  const mixed = compareIssuerBills([
    usageBill("a", 120, 0, 120, "kWh"),
    usageBill("b", 100, 30, 100, "KWH"),
    usageBill("c", 80, 60, 10, "therms"),
  ]);
  assert.equal(mixed.previous.length, 2);
  assert.equal(mixed.usageBillsCompared, 1);
  assert.equal(mixed.averageUsage, 100);
  assert.equal(mixed.usagePercentVsAverage, 20);
});

check("DynamoDB items keep the usage of a bill", () => {
  const doc = usageBill("a", 84.2, 0, 412);
  assert.deepEqual(fromItem(toItem(doc)), doc);
  assert.deepEqual(fromItem(toItem(bill("b", 50, 0))).usage, undefined);
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
    // Used more, at about the same price per kWh.
    assert.equal(c.usageQuantity, 412);
    assert.equal(c.averageUsage, 338);
    assert.equal(c.usagePercentVsAverage, 21.9);
    assert.equal(c.unitPrice, 0.2044);
    assert.equal(c.averageUnitPrice, 0.2049);
    assert.ok(Math.abs(c.unitPricePercentVsAverage!) < 2);
    assert.equal(
      text,
      "Your Brightwave Energy bill is $84.20, about 22% higher than your usual $69. " +
        "You used about 22% more electricity than usual, at about the same price per kWh. " +
        "That's $14.10 more than your previous bill of $70.10.",
    );
    assert.equal(limitSentences(text, 99), limitSentences(text, 3), "more than 3 sentences");
  });

  await checkAsync("compare_bills for every company: usage in the data, not in the speech", async () => {
    const { structuredContent, text } = await runCompareBills({});
    const brightwave = structuredContent.comparisons!.find((c) => c.issuer === "Brightwave Energy")!;
    assert.equal(brightwave.usageTrend, "higher");
    assert.doesNotMatch(text, /You used/);
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
    // The uploaded bill has no usage: no usage numbers and no usage sentence.
    assert.equal(water.structuredContent.comparison?.usageUnit, undefined);
    assert.doesNotMatch(water.text, /You used/);
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
