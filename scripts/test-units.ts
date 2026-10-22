// Small unit checks for the security-sensitive helpers, the agent's keyword routing and the
// data-only tools (on the in-memory seed). No test framework: plain asserts.
// Usage: npm run test:unit   (exit code 1 on the first failed check)

import assert from "node:assert/strict";
import { itemFilterFor, keywordToolFor } from "../lib/agent/agent";
import { itemWords, matchesItem } from "../lib/match";
import { canSendToken } from "../lib/agent/mcpClient";
import { addDays, formatLongDate, periodRange, todayISO } from "../lib/dates";
import { forbiddenHostResponse } from "../lib/hosts";
import { allowRequest, MAX_TRACKED_KEYS } from "../lib/rateLimit";
import { searchDocuments } from "../lib/search";
import { limitSentences } from "../lib/speech";
import { setLlmForTests } from "../lib/llm";
import type { LlmAdapter } from "../lib/llm";
import { getStorage, HOUSEHOLD_ID } from "../lib/storage";
import { buildSeedDocuments } from "../lib/storage/seed";
import { runCheckWarranty } from "../lib/tools/checkWarranty";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { setDynamoForTests } from "../lib/aws";
import { AwsStorage, fromItem, fromStoredItem, toItem } from "../lib/storage/aws";
import { liveDocuments, mergeWithSeed, pickDocument, UPLOAD_TTL_SECONDS, uploadExpiresAt } from "../lib/storage/merge";
import { MemoryStorage } from "../lib/storage/memory";
import { compareIssuerBills, isNoticeablyHigher, runCompareBills, usageSentence } from "../lib/tools/compareBills";
import { disputeRule, findProblems, isDisputeIntent, runDraftReply, templateDraft, toPlainText } from "../lib/tools/draftReply";
import { runAddDocument } from "../lib/tools/addDocument";
import { runListDeadlines } from "../lib/tools/listDeadlines";
import { resolveDocument } from "../lib/tools/resolveDocument";
import { runWeeklyBrief } from "../lib/tools/weeklyBrief";
import type { Document } from "../lib/types";
import { BRAVE_MESSAGE, startListening } from "../components/echo/voice";

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

// Questions about one item, and general questions that must stay unfiltered.
const GENERAL_DATE_QUESTIONS = [
  "When is my next payment due?",
  "What renews soon?",
  "When does my stuff expire?",
  "What do I need to pay this month?",
  "What's due this week?",
  "When are my bills due?",
  "When does anything renew?",
];

check("item filter: the car insurance chip names the item, general questions name none", () => {
  assert.equal(keywordToolFor("When does the car insurance renew?"), "list_deadlines");
  assert.deepEqual(itemFilterFor("When does the car insurance renew?"), { query: "car insurance", kind: "renewal" });
  assert.deepEqual(itemFilterFor("when's the parking fine due?"), { query: "parking fine" });
  // The rest of the message never becomes part of the item's name.
  assert.deepEqual(itemFilterFor("When is my Brightwave bill due and how much is it?"), { query: "brightwave" });
  for (const message of GENERAL_DATE_QUESTIONS) {
    assert.deepEqual(itemFilterFor(message), {}, message);
    assert.deepEqual(itemWords(message), [], message);
  }
});

check("item match: every item word must be in the document, with simple variations", () => {
  const seed = buildSeedDocuments(todayISO());
  const ids = (query: string) => seed.filter((doc) => matchesItem(doc, query)).map((doc) => doc.id);
  for (const query of ["car insurance", "Car Insurance", "auto insurance policy", "Northpoint", "vehicle insurance"]) {
    assert.deepEqual(ids(query), ["doc-northpoint-car-insurance"], query);
  }
  assert.deepEqual(ids("home insurance"), []);
  assert.deepEqual(ids("coffee machine"), []);
  assert.deepEqual(ids("gym membership"), ["doc-peakfit-renewal"]);
  assert.deepEqual(ids("dish washer"), ["doc-homehub-dishwasher"]);
  assert.deepEqual(ids("refrigerator"), ["doc-frostline-fridge"]);
  // "car" is a whole word: it never matches "card" or "cards".
  assert.equal(matchesItem({ ...seed[4], summary: "We charge the card on file." }, "car"), false);
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

// draft_reply: a dispute must say so, with the bill's amount, and give no reason.
const DISPUTE = "dispute my electricity bill";
const amountProblem = (problems: string[]) => problems.some((p) => p.includes("bill's amount"));
const letter = (body: string) => ({ subject: "Dispute", body });

check("draft_reply: dispute intents", () => {
  assert.equal(isDisputeIntent(DISPUTE), true);
  assert.equal(isDisputeIntent("Write a firm letter to Brightwave Energy disputing my bill."), true);
  assert.equal(isDisputeIntent("contest the parking fine"), true);
  assert.equal(isDisputeIntent("ask for a payment extension"), false);
  // Negated: not a dispute.
  assert.equal(isDisputeIntent("I'm not disputing the bill, ask for an extension"), false);
  assert.equal(isDisputeIntent("don't contest it"), false);
  assert.equal(isDisputeIntent("never dispute this"), false);
});

check("draft_reply: cautious phrases are not reasons, real reasons still are", () => {
  const allowed = new Set(["84.2"]);
  const dispute = { intent: DISPUTE, amount: 84.2 };
  const start = "I dispute the $84.20 bill.";
  for (const cautious of [
    "Please correct any errors.",
    "Please review it for any errors or mistakes.",
    "Let me know if anything is wrong.",
    "Please check for possible mistakes.",
  ]) {
    assert.deepEqual(findProblems(letter(`${start} ${cautious}`), allowed, [], dispute), [], cautious);
  }
  const error = findProblems(letter(`${start} There is an error in this bill.`), allowed, [], dispute);
  assert.ok(error.some((p) => p.includes("reason I didn't give (error)")));
});

check("draft_reply: the user's own reason matches by stem", () => {
  const allowed = new Set(["84.2"]);
  const ownReason = { intent: "dispute the bill, it has errors", amount: 84.2 };
  assert.deepEqual(findProblems(letter("I dispute the $84.20 bill: it has an error."), allowed, [], ownReason), []);
  const overcharged = { intent: "dispute it, they are overcharging me", amount: 84.2 };
  assert.deepEqual(findProblems(letter("I dispute the $84.20 bill. I was overcharged."), allowed, [], overcharged), []);
  // Another word is still a reason.
  const wrong = findProblems(letter("I dispute the $84.20 bill. It is wrong."), allowed, [], ownReason);
  assert.ok(wrong.some((p) => p.includes("(wrong)")));
});

check('draft_reply: "I contest ..." says it disputes', () => {
  const contest = { intent: "contest the parking fine", amount: 45 };
  assert.deepEqual(findProblems(letter("I contest the $45 fine."), new Set(["45"]), [], contest), []);
});

check("draft_reply: the dispute amount matches with or without $, commas and trailing zeros", () => {
  const allowed = new Set(["84.2", "1234.5"]);
  for (const written of ["$84.20", "84.20", "$84.2", "84.2"]) {
    const problems = findProblems(letter(`I dispute the ${written} bill.`), allowed, [], { intent: DISPUTE, amount: 84.2 });
    assert.deepEqual(problems, [], written);
  }
  for (const written of ["1,234.50", "$1,234.50", "1234.5", "$1234.50"]) {
    const problems = findProblems(letter(`I dispute the ${written} bill.`), allowed, [], { intent: DISPUTE, amount: 1234.5 });
    assert.deepEqual(problems, [], written);
  }
  for (const written of ["$84.25", "$8,420"]) {
    const problems = findProblems(letter(`I dispute the ${written} bill.`), allowed, [], { intent: DISPUTE, amount: 84.2 });
    assert.equal(amountProblem(problems), true, written);
  }
});

check("draft_reply: a dispute letter must say it disputes and give no reason", () => {
  const allowed = new Set(["84.2"]);
  const dispute = { intent: DISPUTE, amount: 84.2 };
  const soft = findProblems(letter("Please review the $84.20 bill and send me a breakdown."), allowed, [], dispute);
  assert.ok(soft.some((p) => p.includes("dispute the bill")));
  assert.equal(amountProblem(findProblems(letter("I dispute this bill."), allowed, [], dispute)), true);
  const reason = findProblems(letter("I dispute the $84.20 bill. I was overcharged."), allowed, [], dispute);
  assert.ok(reason.some((p) => p.includes("overcharged")));
  // The user's own reason may be repeated.
  const ownReason = { intent: "dispute the bill, I think it has an error", amount: 84.2 };
  assert.deepEqual(findProblems(letter("I dispute the $84.20 bill: it has an error."), allowed, [], ownReason), []);
  assert.deepEqual(findProblems(letter("I dispute the $84.20 bill. Please correct it if needed."), allowed, [], dispute), []);
  // Other intents get no dispute checks.
  assert.deepEqual(findProblems(letter("I am requesting more time to pay the $84.20 bill."), allowed, []), []);
});

check("draft_reply: the template letter disputes the bill with its real amount and date", () => {
  const seed = buildSeedDocuments(todayISO());
  const brightwave = seed.find((doc) => doc.id === "doc-brightwave-bill")!;
  const refs = [{ label: "Account number", value: "BW-4471-2209" }];
  const replyBy = "October 25, 2026";
  const firm = templateDraft(brightwave, DISPUTE, "firm", refs, replyBy);
  assert.match(firm.body, /^I dispute the \$84\.20 charge on your Brightwave Energy electricity bill \(Account number BW-4471-2209\), dated [A-Z][a-z]+ \d{1,2}, \d{4}\./);
  assert.match(firm.body, /itemized breakdown/);
  assert.match(firm.body, /I expect a written response by October 25, 2026\.$/);
  assert.doesNotMatch(firm.body, /\b(error|incorrect|mistake|overcharg\w*|wrong|legal)\b/i);
  assert.equal(firm.subject, "Dispute: Brightwave Energy electricity bill (Account number BW-4471-2209)");
  // It passes the validator's dispute checks itself.
  const dispute = { intent: DISPUTE, amount: 84.2 };
  assert.equal(findProblems(firm, new Set(["84.2"]), refs, dispute).filter((p) => !p.startsWith("It contains figures")).length, 0);
  assert.match(templateDraft(brightwave, DISPUTE, "polite", refs, replyBy).body, /^I would like to dispute the \$84\.20 charge on your /);
  // The agent's fallback passes the whole message as the intent.
  const whole = templateDraft(brightwave, "Write a reply to Brightwave Energy disputing my electricity bill.", "firm", refs, replyBy);
  assert.equal(whole.body, firm.body);
  // Other intents keep the old letter.
  const extension = templateDraft(brightwave, "ask for a payment extension", "firm", refs, replyBy);
  assert.match(extension.body, /^I am writing to ask for a payment extension regarding Brightwave Energy electricity bill/);
  assert.equal(extension.subject, "Ask for a payment extension: Brightwave Energy electricity bill (Account number BW-4471-2209)");
});

check("draft_reply: an extension letter never asks for an itemized breakdown", () => {
  const brightwave = buildSeedDocuments(todayISO()).find((doc) => doc.id === "doc-brightwave-bill")!;
  const replyBy = "October 25, 2026";
  for (const tone of ["polite", "firm"] as const) {
    const draft = templateDraft(brightwave, "ask for a payment extension", tone, [], replyBy);
    assert.doesNotMatch(draft.body, /itemi[sz]ed|breakdown/i, tone);
    const style = { tone, replyBy, amount: 84.2 };
    assert.deepEqual(findProblems(draft, new Set(["84.2", "2026", "25", "31"]), [], undefined, style), [], tone);
  }
  // A model letter that asks for one is sent back; a dispute may ask for it.
  const asked = letter("I am requesting more time to pay the $84.20 bill. Please send an itemized breakdown.");
  assert.ok(findProblems(asked, new Set(["84.2"]), []).some((p) => p.includes("itemized breakdown")));
  assert.equal(findProblems(asked, new Set(["84.2"]), [], { intent: DISPUTE, amount: 84.2 }).some((p) => p.includes("itemized")), false);
});

check("draft_reply: polite asks courteously, firm is direct with the amount and a reply date", () => {
  const brightwave = buildSeedDocuments(todayISO()).find((doc) => doc.id === "doc-brightwave-bill")!;
  const replyBy = "October 25, 2026";
  const polite = templateDraft(brightwave, DISPUTE, "polite", [], replyBy).body;
  const firm = templateDraft(brightwave, DISPUTE, "firm", [], replyBy).body;
  assert.match(polite, /^I would like to dispute .*\n\nCould you please /);
  assert.match(firm, /^I dispute the \$84\.20 charge .*dated /);
  assert.match(firm, /I expect a written response by October 25, 2026\./);
  assert.doesNotMatch(firm, /kindly|I hope|grateful|if possible|sorry|I would like/i);
  assert.notEqual(polite, firm);
  assert.match(disputeRule("polite"), /I would like to dispute/);
  assert.match(disputeRule("firm"), /"I dispute the \$X bill/);

  const allowed = new Set(["84.2", "2026", "25"]);
  const firmStyle = { tone: "firm" as const, replyBy, amount: 84.2 };
  const vague = findProblems(letter("I kindly ask you to review my bill."), allowed, [], undefined, firmStyle);
  assert.ok(vague.some((p) => p.includes(replyBy)));
  assert.ok(vague.some((p) => p.includes("cite the amount")));
  assert.ok(vague.some((p) => p.includes('"kindly"')));
  const direct = letter(`I am requesting more time to pay the $84.20 bill. I expect a written response by ${replyBy}.`);
  assert.deepEqual(findProblems(direct, allowed, [], undefined, firmStyle), []);
  const politeStyle = { tone: "polite" as const, replyBy, amount: 84.2 };
  assert.ok(findProblems(letter("Give me more time."), allowed, [], undefined, politeStyle).some((p) => p.includes("courteous")));
  assert.deepEqual(findProblems(letter("Could you please give me more time?"), allowed, [], undefined, politeStyle), []);
});

check("draft_reply: HTML from the model becomes plain text", () => {
  for (const br of ["<br>", "<br/>", "<br />", "<BR>", "<Br />"]) {
    assert.equal(toPlainText(`a breakdown.${br}${br}Thank you.`), "a breakdown.\n\nThank you.");
  }
  assert.equal(toPlainText("<p>I dispute the bill.</p><p>Please <b>review</b> it.</p>").trim(), "I dispute the bill.\n\nPlease review it.");
  assert.equal(toPlainText('See <a href="https://example.com">this</a> and <span class="x">that</span>.'), "See this and that.");
  // Text that only looks like a tag is kept.
  const plain = "Pay $84.20 within <5 days, if 3 < 4 and 5 > 2. Signed: [Your name]";
  assert.equal(toPlainText(plain), plain);
  assert.equal(toPlainText("One.\n\n\n\nTwo.<br><br><br>Three.\n \n\nFour."), "One.\n\nTwo.\n\nThree.\n\nFour.");
});

async function checkAsync(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

const hasPrev = (ids: string[]) => ids.some((id) => id.includes("-prev-"));

// Virtual seed: rebuilt from the request's date on every read, never taken from storage.
const BRIGHTWAVE = "doc-brightwave-bill";
const brightwaveDue = (docs: Document[]) => docs.find((doc) => doc.id === BRIGHTWAVE)!.deadlines[0].date;
function upload(id: string): Document {
  return { ...bill(id, 40, 0), householdId: HOUSEHOLD_ID };
}

async function seedChecks() {
  await checkAsync("seed dates follow the injected today at read time", async () => {
    // The Brightwave bill is due today + 9.
    assert.equal(brightwaveDue(mergeWithSeed(HOUSEHOLD_ID, [], "2026-11-15")), "2026-11-24");
    assert.equal(brightwaveDue(mergeWithSeed(HOUSEHOLD_ID, [], "2026-11-20")), "2026-11-29");
    assert.equal(mergeWithSeed(HOUSEHOLD_ID, [], "2026-11-15").length, buildSeedDocuments("2026-11-15").length);
  });

  await checkAsync("the seed wins over a stored copy with the same id (stale dates)", async () => {
    const stale = { ...buildSeedDocuments("2026-10-21").find((doc) => doc.id === BRIGHTWAVE)!, title: "Stale copy" };
    const docs = mergeWithSeed(HOUSEHOLD_ID, [stale], "2026-11-15");
    const copies = docs.filter((doc) => doc.id === BRIGHTWAVE);
    assert.equal(copies.length, 1);
    assert.equal(copies[0].title, "Brightwave Energy electricity bill (SAMPLE)");
    assert.equal(copies[0].deadlines[0].date, "2026-11-24");
  });

  await checkAsync("stored documents that are not in the seed are added (own household only)", async () => {
    const docs = mergeWithSeed(HOUSEHOLD_ID, [upload("doc-unit-a"), bill("doc-unit-other-household", 1, 0)], "2026-11-15");
    assert.equal(docs.length, buildSeedDocuments("2026-11-15").length + 1);
    assert.ok(docs.some((doc) => doc.id === "doc-unit-a"));
    assert.ok(!docs.some((doc) => doc.id === "doc-unit-other-household"));
  });

  await checkAsync("pickDocument: seed ids come from the seed, other ids from storage", async () => {
    let loads = 0;
    const load = (doc?: Document) => async () => {
      loads++;
      return doc;
    };
    const stale = { ...buildSeedDocuments("2026-10-21").find((doc) => doc.id === BRIGHTWAVE)!, title: "Stale copy" };
    const seeded = await pickDocument(HOUSEHOLD_ID, BRIGHTWAVE, "2026-11-15", load(stale));
    assert.equal(seeded?.deadlines[0].date, "2026-11-24");
    assert.equal(seeded?.title, "Brightwave Energy electricity bill (SAMPLE)");
    assert.equal(loads, 0); // seed reads never touch storage
    assert.equal((await pickDocument(HOUSEHOLD_ID, "doc-unit-a", "2026-11-15", load(upload("doc-unit-a"))))?.id, "doc-unit-a");
    assert.equal(await pickDocument(HOUSEHOLD_ID, "doc-unit-missing", "2026-11-15", load()), undefined);
    assert.equal(loads, 2);
  });

  await checkAsync("MemoryStorage: today's seed, stored copies of seed ids ignored, uploads kept", async () => {
    const storage = new MemoryStorage();
    const today = todayISO();
    const stale = { ...buildSeedDocuments(addDays(today, -30)).find((doc) => doc.id === BRIGHTWAVE)!, title: "Stale copy" };
    await storage.saveDocument(stale);
    await storage.saveDocument(upload("doc-unit-a"));
    const docs = await storage.listDocuments(HOUSEHOLD_ID);
    assert.equal(brightwaveDue(docs), addDays(today, 9));
    assert.equal(docs.length, buildSeedDocuments(today).length + 1);
    assert.equal((await storage.getDocument(HOUSEHOLD_ID, BRIGHTWAVE))?.title, "Brightwave Energy electricity bill (SAMPLE)");
    assert.equal((await storage.getDocument(HOUSEHOLD_ID, "doc-unit-a"))?.id, "doc-unit-a");
  });

  await checkAsync("uploads expire after 24 hours: expired ones are hidden, fresh ones shown", async () => {
    const now = Date.parse("2026-11-15T12:00:00Z");
    assert.equal(uploadExpiresAt(now), now / 1000 + UPLOAD_TTL_SECONDS);
    assert.equal(UPLOAD_TTL_SECONDS, 86_400);
    const stored = [
      { doc: upload("doc-unit-expired"), expiresAt: now / 1000 - 1 },
      { doc: upload("doc-unit-just-expired"), expiresAt: now / 1000 },
      { doc: upload("doc-unit-fresh"), expiresAt: uploadExpiresAt(now) },
      { doc: upload("doc-unit-no-expiry") },
    ];
    assert.deepEqual(
      liveDocuments(stored, now).map((doc) => doc.id),
      ["doc-unit-fresh", "doc-unit-no-expiry"],
    );
    // A fresh upload is hidden one day later.
    assert.deepEqual(liveDocuments(stored, now + UPLOAD_TTL_SECONDS * 1000).map((doc) => doc.id), ["doc-unit-no-expiry"]);
  });

  await checkAsync("MemoryStorage hides expired uploads in lists and lookups", async () => {
    const storage = new MemoryStorage();
    const nowSeconds = Math.floor(Date.now() / 1000);
    await storage.saveDocument(upload("doc-unit-expired"), { expiresAt: nowSeconds - 60 });
    await storage.saveDocument(upload("doc-unit-fresh"), { expiresAt: uploadExpiresAt(Date.now()) });
    const ids = (await storage.listDocuments(HOUSEHOLD_ID)).map((doc) => doc.id);
    assert.ok(ids.includes("doc-unit-fresh"));
    assert.ok(!ids.includes("doc-unit-expired"));
    assert.equal(await storage.getDocument(HOUSEHOLD_ID, "doc-unit-expired"), undefined);
    const fresh = await storage.getDocument(HOUSEHOLD_ID, "doc-unit-fresh");
    assert.equal(fresh?.id, "doc-unit-fresh");
    assert.equal("expiresAt" in fresh!, false);
  });

  await checkAsync("DynamoDB items: toItem writes expiresAt, fromItem leaves it out of the document", async () => {
    const doc = upload("doc-unit-a");
    assert.equal(toItem(doc, 1_800_000_000).expiresAt, 1_800_000_000);
    assert.equal("expiresAt" in toItem(doc), false);
    assert.deepEqual(fromItem(toItem(doc, 1_800_000_000)), doc);
    assert.deepEqual(fromStoredItem(toItem(doc, 1_800_000_000)), { doc, expiresAt: 1_800_000_000 });
    assert.deepEqual(fromStoredItem(toItem(doc)), { doc, expiresAt: undefined });
  });

  await checkAsync("AwsStorage: today's seed, expired uploads hidden, valid and legacy uploads kept", async () => {
    const today = todayISO();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const stale = { ...buildSeedDocuments(addDays(today, -30)).find((doc) => doc.id === BRIGHTWAVE)!, title: "Stale copy" };
    // What an older seed script and add_document left in the table.
    const items = [
      toItem(upload("doc-unit-aws-expired"), nowSeconds - 60),
      toItem(stale),
      toItem(upload("doc-unit-aws-fresh"), uploadExpiresAt(Date.now())),
      toItem(upload("doc-unit-aws-legacy")),
    ];
    let gets = 0;
    const fakeDynamo = {
      async send(command: QueryCommand | GetCommand) {
        if (command instanceof QueryCommand) {
          const pk = command.input.ExpressionAttributeValues?.[":pk"];
          return { Items: items.filter((item) => item.pk === pk) };
        }
        gets++;
        const { pk, sk } = command.input.Key!;
        return { Item: items.find((item) => item.pk === pk && item.sk === sk) };
      },
    };
    setDynamoForTests(fakeDynamo as unknown as DynamoDBDocumentClient);
    try {
      const storage = new AwsStorage();
      const docs = await storage.listDocuments(HOUSEHOLD_ID);
      const ids = docs.map((doc) => doc.id);
      assert.equal(docs.length, buildSeedDocuments(today).length + 2);
      assert.equal(docs.filter((doc) => doc.id === BRIGHTWAVE).length, 1);
      assert.equal(brightwaveDue(docs), addDays(today, 9));
      assert.ok(!docs.some((doc) => doc.title === "Stale copy"));
      assert.ok(ids.includes("doc-unit-aws-fresh"));
      assert.ok(ids.includes("doc-unit-aws-legacy"));
      assert.ok(!ids.includes("doc-unit-aws-expired"));
      assert.doesNotMatch(JSON.stringify(docs), /expiresAt/);

      const seeded = await storage.getDocument(HOUSEHOLD_ID, BRIGHTWAVE);
      assert.equal(seeded?.title, "Brightwave Energy electricity bill (SAMPLE)");
      assert.equal(seeded?.deadlines[0].date, addDays(today, 9));
      assert.equal(gets, 0); // seed ids never read the table
      assert.equal(await storage.getDocument(HOUSEHOLD_ID, "doc-unit-aws-expired"), undefined);
      const fresh = await storage.getDocument(HOUSEHOLD_ID, "doc-unit-aws-fresh");
      assert.equal(fresh?.id, "doc-unit-aws-fresh");
      assert.equal((await storage.getDocument(HOUSEHOLD_ID, "doc-unit-aws-legacy"))?.id, "doc-unit-aws-legacy");
      assert.equal(await storage.getDocument(HOUSEHOLD_ID, "doc-unit-aws-missing"), undefined);
      assert.doesNotMatch(JSON.stringify([seeded, fresh]), /expiresAt/);
    } finally {
      setDynamoForTests(undefined);
    }
  });
}

// Voice input: Brave gets a clear message instead of recognition that ends silently.
// A fake browser window with a fake webkitSpeechRecognition that counts starts.
async function withFakeBrowser(brave: (() => Promise<boolean>) | undefined, fn: (counts: { created: number; started: number }) => Promise<void>) {
  const counts = { created: 0, started: 0 };
  class FakeRecognition {
    onresult = null;
    onerror = null;
    onend = null;
    constructor() {
      counts.created++;
    }
    start() {
      counts.started++;
    }
    stop() {}
    abort() {}
  }
  const navigator = brave ? { brave: { isBrave: brave } } : {};
  const global = globalThis as { window?: unknown };
  global.window = { webkitSpeechRecognition: FakeRecognition, navigator };
  try {
    await fn(counts);
  } finally {
    delete global.window;
  }
}

function listenHandlers() {
  const calls = { errors: [] as string[], ends: 0 };
  const handlers = {
    onInterim: () => {},
    onFinal: () => {},
    onError: (message: string) => calls.errors.push(message),
    onEnd: () => calls.ends++,
  };
  return { calls, handlers };
}

async function voiceChecks() {
  await checkAsync("voice: Brave shows a message and never starts recognition", async () => {
    await withFakeBrowser(async () => true, async (counts) => {
      const { calls, handlers } = listenHandlers();
      startListening(handlers);
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.deepEqual(calls.errors, [BRAVE_MESSAGE]);
      assert.equal(calls.ends, 1);
      assert.equal(counts.created, 0);
    });
  });

  await checkAsync("voice: other browsers start recognition right away, as before", async () => {
    await withFakeBrowser(undefined, async (counts) => {
      const { calls, handlers } = listenHandlers();
      startListening(handlers);
      assert.equal(counts.started, 1); // synchronously, no await before start()
      assert.deepEqual(calls.errors, []);
    });
  });

  await checkAsync("voice: navigator.brave that says it isn't Brave still starts", async () => {
    await withFakeBrowser(async () => false, async (counts) => {
      const { calls, handlers } = listenHandlers();
      startListening(handlers);
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(counts.started, 1);
      assert.deepEqual(calls.errors, []);
    });
  });
}

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

  await checkAsync("list_deadlines query: the car insurance renewal, never the gym's", async () => {
    const { text, structuredContent } = await runListDeadlines({ kind: "renewal", query: "car insurance" });
    assert.deepEqual(
      structuredContent.deadlines.map((d) => d.documentId),
      ["doc-northpoint-car-insurance"],
    );
    assert.equal(structuredContent.found, true);
    assert.match(text, /^Northpoint Mutual: car insurance policy renews automatically on .+, in 21 days, for \$612\.00\.$/);
    assert.doesNotMatch(text, /PeakFit/);
    // The chip's filter, as the agent builds it, gives the same answer.
    const chip = await runListDeadlines(itemFilterFor("When does the car insurance renew?"));
    assert.equal(chip.text, text);
    // Kind payment_due for a renewal: still the car insurance, not another payment.
    const due = await runListDeadlines({ kind: "payment_due", query: "auto insurance policy" });
    assert.deepEqual(
      due.structuredContent.deadlines.map((d) => d.documentId),
      ["doc-northpoint-car-insurance"],
    );
  });

  await checkAsync("list_deadlines query: an item that isn't on file says so, then lists that kind", async () => {
    const { text, structuredContent } = await runListDeadlines({ kind: "renewal", query: "home insurance" });
    assert.equal(structuredContent.found, false);
    assert.match(text, /^I couldn't find a renewal for home insurance\. Upcoming renewals: PeakFit on .+, and Northpoint Mutual on .+\.$/);
    assert.deepEqual(
      structuredContent.deadlines.map((d) => d.issuer),
      ["PeakFit", "Northpoint Mutual"],
    );
    // An item on file without an upcoming deadline: the washing machine warranty ended last month.
    const washer = await runListDeadlines({ query: "washing machine" });
    assert.equal(washer.structuredContent.found, false);
    assert.match(washer.text, /^I found your washing machine, but it has no upcoming deadline\. Upcoming deadlines: /);
  });

  await checkAsync("list_deadlines: general questions get no filter and the normal list", async () => {
    const plain = await runListDeadlines({});
    for (const message of GENERAL_DATE_QUESTIONS) {
      const result = await runListDeadlines(itemFilterFor(message));
      assert.equal(result.text, plain.text, message);
    }
    // A query that names no item is no filter.
    assert.equal((await runListDeadlines({ query: "my bills" })).text, plain.text);
    assert.equal((await runListDeadlines({ query: "stuff" })).text, plain.text);
    assert.doesNotMatch(plain.text, /couldn't find/);
  });

  await checkAsync("list_deadlines: a natural question about each seed item returns that item", async () => {
    const questions: [string, string][] = [
      ["When is the electricity bill due?", "doc-brightwave-bill"],
      ["When does the car insurance renew?", "doc-northpoint-car-insurance"],
      ["When does the dishwasher warranty end?", "doc-homehub-dishwasher"],
      ["When is the parking ticket due?", "doc-maplewood-parking"],
      ["When does the gym membership renew?", "doc-peakfit-renewal"],
      ["When is the field trip form due?", "doc-maplewood-field-trip"],
      ["When does the TV warranty end?", "doc-visionmax-tv"],
      ["When does the fridge warranty expire?", "doc-frostline-fridge"],
      ["When does the laptop warranty end?", "doc-pinewood-laptop"],
    ];
    for (const [message, id] of questions) {
      const { structuredContent, text } = await runListDeadlines(itemFilterFor(message));
      assert.equal(structuredContent.found, true, message);
      assert.equal(structuredContent.deadlines[0].documentId, id, message);
      assert.ok(structuredContent.deadlines.every((d) => d.documentId === id), message);
      assert.doesNotMatch(text, /couldn't find/, message);
    }
  });

  await checkAsync("check_warranty: each seed warranty by name and variations, never another product", async () => {
    const products: [string, string][] = [
      ["dishwasher", "doc-homehub-dishwasher"],
      ["dish washer", "doc-homehub-dishwasher"],
      ["dishwasher warranty", "doc-homehub-dishwasher"],
      ["TV", "doc-visionmax-tv"],
      ["television", "doc-visionmax-tv"],
      ["fridge", "doc-frostline-fridge"],
      ["refrigerator", "doc-frostline-fridge"],
      ["washing machine", "doc-aquaspin-washer"],
      ["washer", "doc-aquaspin-washer"],
      ["laptop", "doc-pinewood-laptop"],
      ["Pinewood computer", "doc-pinewood-laptop"],
    ];
    for (const [product, id] of products) {
      const { structuredContent } = await runCheckWarranty({ product });
      assert.equal(structuredContent.warranty?.documentId, id, product);
    }
    for (const product of ["coffee machine", "Samsung TV", "car"]) {
      const { structuredContent, text } = await runCheckWarranty({ product });
      assert.equal(structuredContent.found, false, product);
      assert.equal(text, `I couldn't find a warranty for ${product}.`);
    }
  });

  await checkAsync("document lookups: two natural phrasings find each of the 14 seed documents", async () => {
    const seed = buildSeedDocuments(todayISO());
    assert.equal(seed.length, 14);
    // "September": earlier bills are named by their month.
    const month = (id: string) => seed.find((doc) => doc.id === id)!.title.match(/, (\w+) \(SAMPLE\)/)![1];
    const items: [string, string, string][] = [
      ["doc-brightwave-bill", "Brightwave Energy", "electricity bill"],
      ["doc-northpoint-car-insurance", "Northpoint Mutual", "car insurance"],
      ["doc-homehub-dishwasher", "HomeHub Appliances", "dishwasher receipt"],
      ["doc-maplewood-parking", "City of Maplewood", "parking notice"],
      ["doc-peakfit-renewal", "PeakFit", "gym membership"],
      ["doc-maplewood-field-trip", "Maplewood Elementary", "field trip form"],
      ["doc-visionmax-tv", "VisionMax", "TV receipt"],
      ["doc-frostline-fridge", "FrostLine", "fridge receipt"],
      ["doc-aquaspin-washer", "AquaSpin", "washing machine receipt"],
      ["doc-pinewood-laptop", "Pinewood Computers", "laptop receipt"],
      ["doc-brightwave-bill-prev-1", "Brightwave Energy", `${month("doc-brightwave-bill-prev-1")} electricity bill`],
      ["doc-brightwave-bill-prev-2", "Brightwave Energy", `${month("doc-brightwave-bill-prev-2")} electricity bill`],
      ["doc-riverside-water-prev-1", "Riverside Water Company", `${month("doc-riverside-water-prev-1")} water bill`],
      ["doc-riverside-water-prev-2", "Riverside Water Company", `${month("doc-riverside-water-prev-2")} water bill`],
    ];
    assert.deepEqual(items.map(([id]) => id).sort(), seed.map((doc) => doc.id).sort());
    for (const [id, issuer, item] of items) {
      for (const query of [`Explain my ${item} letter`, `Write a reply to ${issuer} about my ${item}`]) {
        assert.equal((await resolveDocument({ query })).id, id, query);
      }
      // As Nova sends it: the sender in issuer, the item in query.
      assert.equal((await resolveDocument({ issuer, query: item })).id, id, `${issuer} / ${item}`);
    }
    assert.equal(
      (await resolveDocument({ query: "Write a reply to Brightwave Energy disputing my electricity bill." })).id,
      "doc-brightwave-bill",
    );
  });

  await checkAsync("document lookups: another kind of item is never the answer", async () => {
    await assert.rejects(resolveDocument({ query: "Explain my home insurance letter" }), {
      message: "I couldn't find any document about home insurance.",
    });
    await assert.rejects(resolveDocument({ query: "phone bill" }), /couldn't find any document about phone bill/);
    // "fine" and "phone number" are not kinds of item: the lookup works as before.
    assert.equal((await resolveDocument({ query: "Is this parking letter fine?" })).id, "doc-maplewood-parking");
    assert.equal((await resolveDocument({ query: "the phone number on my dishwasher receipt" })).id, "doc-homehub-dishwasher");
    assert.equal((await resolveDocument({ query: "Explain the parking fine letter." })).id, "doc-maplewood-parking");
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

  await checkAsync("draft_reply with a simulated LLM: the dispute rule only for disputes", async () => {
    // Records every prompt and answers like Nova would, from the goal in the prompt.
    const prompts: string[] = [];
    const fake: LlmAdapter = {
      async generateJson<T>({ prompt }: { prompt: string }): Promise<T> {
        prompts.push(prompt);
        const body = prompt.includes(disputeRule("firm"))
          ? "I dispute the $84.20 bill.\n\nPlease review it and send me an itemized breakdown."
          : "I am requesting more time to pay the $84.20 bill.";
        // A firm letter asks for a written response by the date in the prompt.
        const replyBy = prompt.match(/written response by ([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1];
        return { subject: "Brightwave bill", body: `${body}\n\nI expect a written response by ${replyBy}.` } as T;
      },
    };
    setLlmForTests(fake);
    try {
      await runDraftReply({ issuer: "Brightwave Energy", intent: "ask for a payment extension", tone: "firm" });
      assert.equal(prompts.length, 1);
      assert.equal(prompts[0].includes(disputeRule("firm")), false);

      const disputed = await runDraftReply({ issuer: "Brightwave Energy", intent: "dispute my electricity bill", tone: "firm" });
      assert.ok(prompts.at(-1)!.includes(disputeRule("firm")));
      assert.match(disputed.structuredContent.body, /disput/i);
      assert.match(disputed.structuredContent.body, /84\.20/);
    } finally {
      setLlmForTests(undefined);
    }
  });

  await checkAsync("draft_reply with a simulated LLM: no HTML in the letter, polite or firm", async () => {
    // The reply-by date the firm tone asks for (today + 7 days).
    const replyBy = formatLongDate(addDays(todayISO(), 7));
    const fake: LlmAdapter = {
      async generateJson<T>(): Promise<T> {
        const body =
          "Dear Brightwave Energy,<br><br>I dispute the $84.20 bill.<br/><br/><br/>Please send an itemized breakdown.<br><br>" +
          `I expect a written response by ${replyBy}.<br><br>Sincerely,<br>[Your name]`;
        return { subject: "Dispute:<br> <b>electricity bill</b>", body } as T;
      },
    };
    setLlmForTests(fake);
    try {
      for (const tone of ["polite", "firm"] as const) {
        const { structuredContent: draft } = await runDraftReply({ issuer: "Brightwave Energy", intent: DISPUTE, tone });
        assert.doesNotMatch(`${draft.subject}\n${draft.body}`, /<\/?[a-z]/i);
        assert.equal(draft.subject, "Dispute: electricity bill");
        assert.equal(
          draft.body,
          "Dear Brightwave Energy,\n\nI dispute the $84.20 bill.\n\nPlease send an itemized breakdown.\n\n" +
            `I expect a written response by ${replyBy}.\n\nSincerely,\n[Your name]`,
        );
      }
    } finally {
      setLlmForTests(undefined);
    }
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

  // Also saves into the shared store (a letter, so it changes no bill or deadline check above).
  await checkAsync("add_document stores a 24-hour expiry that never shows in its result", async () => {
    const fake: LlmAdapter = {
      async generateJson<T>(): Promise<T> {
        return {
          type: "other",
          title: "Unit test letter",
          issuer: "Unit Test Sender",
          deadlines: [],
          summary: "A test letter.",
          actionItems: [],
          rawText: "A test letter.",
        } as T;
      },
    };
    const storage = getStorage();
    const save = storage.saveDocument.bind(storage);
    let expiresAt: number | undefined;
    storage.saveDocument = async (doc, options) => {
      expiresAt = options?.expiresAt;
      return save(doc, options);
    };
    setLlmForTests(fake);
    try {
      const before = Date.now();
      const result = await runAddDocument({ text: "A test letter." });
      assert.ok(expiresAt! >= uploadExpiresAt(before) && expiresAt! <= uploadExpiresAt(Date.now()));
      assert.doesNotMatch(JSON.stringify(result), /expiresAt/);
      const id = result.structuredContent.document.id;
      const saved = await storage.getDocument(HOUSEHOLD_ID, id);
      assert.equal(saved?.title, "Unit test letter");
      assert.doesNotMatch(JSON.stringify(saved), /expiresAt/);
      assert.ok((await storage.listDocuments(HOUSEHOLD_ID)).some((doc) => doc.id === id));
    } finally {
      storage.saveDocument = save;
      setLlmForTests(undefined);
    }
  });
}

seedChecks()
  .then(voiceChecks)
  .then(storageChecks)
  .then(() => console.log(`\n${passed} checks passed.`))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
