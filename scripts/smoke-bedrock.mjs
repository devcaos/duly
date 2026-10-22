// Sends the demo questions to /api/chat and prints, for each one, the tool chosen, how it was
// chosen (route) and the spoken reply. Run it against a server that uses real Bedrock.
// Usage:
//   npm run dev                                       (in another terminal)
//   npm run smoke:bedrock                             (http://localhost:3000)
//   npm run smoke:bedrock -- https://your-preview.vercel.app
// Routes: model = Nova picked the tool; forced-keyword / forced-any = Nova answered in text and
// was asked again requiring a tool; server-default = the server called the tool itself.
// Exit code 1 if any question gets the wrong tool, the wrong document or a wrong reply, or if a
// dispute letter fails its letter check (plain text, no HTML tags; counted separately from the
// routing; skipped when the routing already failed). "letter: OK (template)" means the server's fallback letter, not Nova's.
// Questions about a bill must use the latest bill, never an earlier one ("-prev-" ids).
// Never reads or prints environment values.

const BASE_URL = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const MAX_HISTORY_TURNS = 4; // same as lib/agent/types.ts

const LATEST_BRIGHTWAVE = "doc-brightwave-bill";
// The Brightwave bill is higher because more was used, not because the price per kWh went up.
const BRIGHTWAVE_USAGE = /22% higher.*You used about 22% more electricity than usual, at about the same price per kWh\./;

// Single questions, each with an empty history (like the first thing said to Alexa).
// says: the spoken reply must match. documentId: the document the tool must use.
// noEarlierBills: no earlier bill may appear in the deadlines card.
// onlyIssuer: the deadlines card must list only (and at least one) deadline from this issuer.
// letter: the draft must dispute the bill, with its amount and no reason (letter check).
const SINGLE = [
  { message: "What do I need to pay this month?", tool: "list_deadlines", noEarlierBills: true },
  { message: "Is my dishwasher still under warranty?", tool: "check_warranty" },
  { message: "Which of my warranties are still active?", tool: "check_warranty" },
  { message: "Explain the parking fine letter.", tool: "explain_document" },
  { message: "Explain my Brightwave electricity bill.", tool: "explain_document", documentId: LATEST_BRIGHTWAVE },
  { message: "Is my Brightwave bill higher than usual?", tool: "compare_bills", says: BRIGHTWAVE_USAGE },
  { message: "Give me my weekly brief.", tool: "weekly_brief" },
  { message: "Is my fridge still under warranty?", tool: "check_warranty", says: /expiring soon/i },
  // About the car insurance only, never the nearest other renewal (PeakFit).
  {
    message: "When does the car insurance renew?",
    tool: "list_deadlines",
    says: /^Northpoint Mutual: .*renews/,
    onlyIssuer: "Northpoint Mutual",
  },
  {
    message: "Write a firm letter to Brightwave Energy disputing my bill.",
    tool: "draft_reply",
    tone: "firm",
    documentId: LATEST_BRIGHTWAVE,
    letter: true,
  },
];

// One conversation: each question carries the earlier turns, like the page does. Most
// questions come right after a turn that returned a document.
const CONVERSATION = [
  { message: "Explain the parking fine letter.", tool: "explain_document" },
  { message: "Is my Brightwave bill higher than usual?", tool: "compare_bills", says: BRIGHTWAVE_USAGE },
  { message: "Is my dishwasher still under warranty?", tool: "check_warranty" },
  { message: "Which of my warranties are still active?", tool: "check_warranty" },
  { message: "What do I need to pay this month?", tool: "list_deadlines", noEarlierBills: true },
  {
    message: "Write a reply to Brightwave Energy disputing my electricity bill.",
    tool: "draft_reply",
    documentId: LATEST_BRIGHTWAVE,
    letter: true,
  },
  {
    message: "Make it firmer.",
    tool: "draft_reply",
    tone: "firm",
    sameDocumentAsPrevious: true,
    documentId: LATEST_BRIGHTWAVE,
    letter: true,
  },
];

async function ask(message, history) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history }),
    });
    // Too many questions in a minute: wait once (this is not a retry of the tool choice).
    if (response.status === 429 && attempt === 1) {
      console.log("  (rate limited by /api/chat, waiting 60 s)");
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      continue;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error ?? "no error message"}`);
    return body;
  }
}

// The tool whose sentence is spoken: the last one that isn't a plain search.
function mainTool(turn) {
  return turn.tools.findLast((tool) => tool.name !== "search_documents") ?? turn.tools.at(-1);
}

let failures = 0;
const routes = {};
const letters = { checked: 0, failed: 0, skipped: 0 };

// The Brightwave bill's amount, compared as a value ("$84.20", "84.2").
const BRIGHTWAVE_AMOUNT = 84.2;
// Same rules as lib/tools/draftReply.ts: cautious phrases ("correct any errors") give no reason.
const ERROR_WORDS = /\b(error|errors|incorrect|mistakes?|overcharg\w*|wrong)\b/i;
const CAUTIOUS = /\b(any|possible)\s+(errors?|mistakes?)(\s+or\s+(errors?|mistakes?))?\b|\bif\b[^.]*\b(wrong|incorrect)\b/gi;
// "<br>", "</p>", "<b class=...>": letters must be plain text ("<5 days" is fine).
const HTML_TAG = /<\/?[a-z][a-z0-9]*(\s[^<>]*)?\/?>/i;
// The server's template letter (firm or polite), as built by templateDraft().
const TEMPLATE_LETTER =
  /^Dear [^\n]+\n\n(I dispute|I would like to dispute) the (\S+ charge|charges) on your [^\n]+\.\n\n(Please|Could you please) review this bill, correct it if needed, and send me an itemized breakdown/;

function draftCard(result) {
  return result.cards.find((card) => card.kind === "draft")?.data;
}

function draftBody(result) {
  return draftCard(result)?.body;
}

// What's wrong with a dispute letter (empty when it's fine).
function letterProblems(result) {
  const body = draftBody(result);
  if (typeof body !== "string") return ["no draft card"];
  const problems = [];
  if (!/\b(disput|contest)/i.test(body)) problems.push("doesn't say it disputes the bill");
  const numbers = body.replace(/(\d),(\d)/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? [];
  if (!numbers.some((n) => Number(n) === BRIGHTWAVE_AMOUNT)) problems.push(`no amount ${BRIGHTWAVE_AMOUNT}`);
  const reason = body.replace(CAUTIOUS, "").match(ERROR_WORDS);
  if (reason) problems.push(`gives a reason ("${reason[0]}")`);
  const tag = `${draftCard(result).subject}\n${body}`.match(HTML_TAG);
  if (tag) problems.push(`contains HTML tags ("${tag[0]}")`);
  return problems;
}

async function run(title, questions, keepHistory) {
  console.log(`\n=== ${title} ===`);
  let history = [];
  let previous;
  for (const question of questions) {
    console.log(`\nQ: ${question.message}`);
    let result;
    try {
      result = await ask(question.message, keepHistory ? history : []);
    } catch (error) {
      failures++;
      console.log(`  FAIL  ${error.message}`);
      continue;
    }
    const main = mainTool(result.turn);
    const problems = [];
    if (main?.name !== question.tool) problems.push(`expected ${question.tool}`);
    if (question.tone && main?.input.tone !== question.tone) problems.push(`expected tone ${question.tone}`);
    if (question.sameDocumentAsPrevious && main?.documentId !== previous?.documentId) {
      problems.push("expected the same document as the previous draft");
    }
    if (question.documentId && main?.documentId !== question.documentId) {
      problems.push(`expected document ${question.documentId}, got ${main?.documentId ?? "none"}`);
    }
    if (main?.documentId?.includes("-prev-")) problems.push(`used an earlier bill (${main.documentId})`);
    if (question.says && !question.says.test(result.reply)) problems.push(`expected the reply to match ${question.says}`);
    if (question.noEarlierBills) {
      const listed = result.cards.flatMap((card) => card.data.deadlines ?? []).map((d) => d.documentId);
      if (listed.some((id) => id.includes("-prev-"))) problems.push("an earlier bill was listed as a deadline");
    }
    if (question.onlyIssuer) {
      const issuers = result.cards.flatMap((card) => card.data.deadlines ?? []).map((d) => d.issuer);
      if (issuers.length === 0 || issuers.some((issuer) => issuer !== question.onlyIssuer)) {
        problems.push(`expected only ${question.onlyIssuer} deadlines, got ${[...new Set(issuers)].join(", ") || "none"}`);
      }
    }
    if (problems.length > 0) failures++;
    routes[result.route] = (routes[result.route] ?? 0) + 1;

    const tools = result.turn.tools.map((tool) => tool.name).join(" -> ") || "none";
    const tone = main?.input.tone ? ` (tone: ${main.input.tone})` : "";
    const doc = main?.documentId ? `  doc: ${main.documentId}` : "";
    console.log(`  ${problems.length > 0 ? "FAIL" : "OK  "}  tool: ${tools}${tone}  route: ${result.route}${doc}`);
    if (problems.length > 0) console.log(`        ${problems.join("; ")}`);
    console.log(`  says: ${result.reply}`);
    if (question.letter && problems.length > 0) {
      // Wrong tool or document: already a routing failure, so it isn't counted twice.
      letters.skipped++;
      console.log("  letter: skipped (routing failed)");
    } else if (question.letter) {
      // Reported on its own line and counted apart: never a routing failure.
      const wrong = letterProblems(result);
      letters.checked++;
      if (wrong.length > 0) letters.failed++;
      const source = TEMPLATE_LETTER.test(draftBody(result)) ? " (template)" : "";
      console.log(`  letter: ${wrong.length > 0 ? `FAIL (${wrong.join("; ")})` : "OK"}${source}`);
    }

    history = [...history, result.turn].slice(-MAX_HISTORY_TURNS);
    previous = main;
  }
}

console.log(`Duly smoke test against ${BASE_URL}`);
await run("Single questions (no history)", SINGLE, false);
await run("Conversation (history carried)", CONVERSATION, true);

const total = SINGLE.length + CONVERSATION.length;
const summary = Object.entries(routes)
  .map(([route, count]) => `${route}: ${count}`)
  .join(", ");
console.log(`\n${total - failures}/${total} OK. Routes: ${summary || "none"}.`);
const skipped = letters.skipped > 0 ? ` (${letters.skipped} skipped)` : "";
console.log(`Letter checks: ${letters.checked - letters.failed}/${letters.checked} OK${skipped}`);
process.exit(failures > 0 || letters.failed > 0 ? 1 : 0);
