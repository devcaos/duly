// Sends the demo questions to /api/chat and prints, for each one, the tool chosen, how it was
// chosen (route) and the spoken reply. Run it against a server that uses real Bedrock.
// Usage:
//   npm run dev                                       (in another terminal)
//   npm run smoke:bedrock                             (http://localhost:3000)
//   npm run smoke:bedrock -- https://your-preview.vercel.app
// Routes: model = Nova picked the tool; forced-keyword / forced-any = Nova answered in text and
// was asked again requiring a tool; server-default = the server called the tool itself.
// Exit code 1 if any question gets the wrong tool. Never reads or prints environment values.

const BASE_URL = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const MAX_HISTORY_TURNS = 4; // same as lib/agent/types.ts

// Single questions, each with an empty history (like the first thing said to Alexa).
const SINGLE = [
  { message: "What do I need to pay this month?", tool: "list_deadlines" },
  { message: "Is my dishwasher still under warranty?", tool: "check_warranty" },
  { message: "Which of my warranties are still active?", tool: "check_warranty" },
  { message: "Explain the parking fine letter.", tool: "explain_document" },
];

// One conversation: each question carries the earlier turns, like the page does. Most
// questions come right after a turn that returned a document.
const CONVERSATION = [
  { message: "Explain the parking fine letter.", tool: "explain_document" },
  { message: "Is my dishwasher still under warranty?", tool: "check_warranty" },
  { message: "Which of my warranties are still active?", tool: "check_warranty" },
  { message: "What do I need to pay this month?", tool: "list_deadlines" },
  { message: "Write a reply to Brightwave Energy disputing my electricity bill.", tool: "draft_reply" },
  { message: "Make it firmer.", tool: "draft_reply", tone: "firm", sameDocumentAsPrevious: true },
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
    if (problems.length > 0) failures++;
    routes[result.route] = (routes[result.route] ?? 0) + 1;

    const tools = result.turn.tools.map((tool) => tool.name).join(" -> ") || "none";
    const tone = main?.input.tone ? ` (tone: ${main.input.tone})` : "";
    console.log(`  ${problems.length > 0 ? "FAIL" : "OK  "}  tool: ${tools}${tone}  route: ${result.route}`);
    if (problems.length > 0) console.log(`        ${problems.join("; ")}`);
    console.log(`  says: ${result.reply}`);

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
process.exit(failures > 0 ? 1 : 0);
