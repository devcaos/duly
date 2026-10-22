// Local stand-in for Amazon Bedrock (Converse) and Amazon Polly, for testing the demo web
// without AWS credentials. The app code doesn't change: the AWS SDK sends its requests here
// because of the AWS_ENDPOINT_URL_* variables. Answers are canned, picked by keywords.
//
// Usage:
//   npm run mock:aws                (in one terminal)
//   then start the app with these variables (e.g. in .env.local) and `npm run dev`:
//     LLM_PROVIDER=bedrock
//     AWS_ENDPOINT_URL_BEDROCK_RUNTIME=http://localhost:4010
//     AWS_ENDPOINT_URL_POLLY=http://localhost:4010
//     AWS_ACCESS_KEY_ID=mock
//     AWS_SECRET_ACCESS_KEY=mock
// MOCK_POLLY=fail makes Polly answer 503, to test the browser voice fallback.

import { createServer } from "node:http2";

// The Bedrock Runtime and Polly clients both use HTTP/2 (plaintext h2c here), so one port serves both.
const PORT = 4010;
const LATENCY_MS = 500; // feels like a real model call

const today = () => new Date().toISOString().slice(0, 10);
function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function endOfMonth(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}
const spokenDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
const money = (amount) => (amount === undefined ? "" : `$${Number(amount).toFixed(2)}`);
let nextId = 1;
const toolUseId = () => `tooluse_mock${nextId++}`;

// ---------- Bedrock Converse ----------

function converse(body) {
  const forced = body.toolConfig?.toolChoice?.tool?.name;
  if (forced === "return_result") {
    // Duly's document tools (lib/llm/bedrock.ts) force one tool whose input is the answer.
    return toolUseReply(forced, structuredAnswer(body));
  }
  // Like real Bedrock: when a tool result mixes text and json blocks, the tools are silently
  // dropped from the request and Nova can only answer in text (see FRICTION.md).
  if (mixesTextAndJson(body.messages ?? [])) return textReply("Okay, let me look at the earlier letter first.");
  const mustUseTool = Boolean(body.toolConfig?.toolChoice?.any) || Boolean(forced);
  const reply = agentTurn(body.messages ?? [], mustUseTool);
  // toolChoice { tool }: the model must call that tool, so it only fills the arguments.
  const picked = reply.output.message.content[0].toolUse;
  if (forced && picked?.name !== forced) return toolUseReply(forced, {});
  return reply;
}

function mixesTextAndJson(messages) {
  return messages.some((message) =>
    (message.content ?? []).some((block) => {
      const content = block.toolResult?.content ?? [];
      return content.some((part) => part.json !== undefined) && content.some((part) => part.text !== undefined);
    }),
  );
}

function toolUseReply(name, input) {
  return {
    output: { message: { role: "assistant", content: [{ toolUse: { toolUseId: toolUseId(), name, input } }] } },
    stopReason: "tool_use",
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    metrics: { latencyMs: LATENCY_MS },
  };
}

function textReply(text) {
  return {
    output: { message: { role: "assistant", content: [{ text }] } },
    stopReason: "end_turn",
    usage: { inputTokens: 100, outputTokens: 30, totalTokens: 130 },
    metrics: { latencyMs: LATENCY_MS },
  };
}

const promptText = (body) =>
  (body.messages?.[0]?.content ?? [])
    .map((block) => block.text ?? "")
    .join("\n");
const systemText = (body) => (body.system ?? []).map((block) => block.text ?? "").join("\n");

function documentFromPrompt(prompt, endMarker) {
  const start = prompt.indexOf("Document:\n");
  const end = start + prompt.slice(start).search(endMarker);
  try {
    return JSON.parse(prompt.slice(start + "Document:\n".length, end));
  } catch {
    return { title: "your document", issuer: "the sender", type: "other", deadlines: [] };
  }
}

function nextDeadline(doc) {
  return [...(doc.deadlines ?? [])].sort((a, b) => a.date.localeCompare(b.date)).find((d) => d.date >= today());
}

function structuredAnswer(body) {
  const system = systemText(body);
  const prompt = promptText(body);

  if (system.includes("You extract structured data")) {
    const text = prompt.split("Document text:\n")[1] ?? "";
    const firstLine = text.split("\n").find((line) => line.trim()) ?? "";
    const issuer = firstLine.replace(/^SAMPLE\s*[-–]\s*/i, "").trim() || "Riverside Water Company";
    const amountMatch = text.match(/\$\s?(\d[\d,]*\.\d{2})/);
    const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, "")) : 56.75;
    const due = addDays(today(), 14);
    return {
      type: "bill",
      title: `${issuer} water bill`,
      issuer,
      issueDate: today(),
      amount,
      currency: "USD",
      deadlines: [{ date: due, kind: "payment_due", description: "Pay the water bill", amount, currency: "USD" }],
      summary: `Water bill from ${issuer} for ${money(amount)}, due ${spokenDate(due)}. A $5.00 late fee applies after that.`,
      actionItems: [`Pay ${money(amount)} by ${spokenDate(due)}`, "Call 1-800-555-0190 with questions"],
      rawText: text || "SAMPLE - Riverside Water Company water bill (mock extraction of an uploaded file).",
    };
  }

  if (system.includes("You explain household paperwork")) {
    const doc = documentFromPrompt(prompt, "\n\nQuestion:");
    const next = nextDeadline(doc);
    const when = next ? ` by ${spokenDate(next.date)}` : "";
    return {
      spokenAnswer: `This is ${doc.title} from ${doc.issuer}. ${doc.summary ?? doc.title} If you ignore it, you may pay extra fees, so act${when}.`,
      explanation: doc.summary ?? `This is ${doc.title} from ${doc.issuer}.`,
      consequencesOfInaction: `${doc.issuer} can add late fees or escalate the matter if nothing happens${when}.`,
      recommendedNextStep: (doc.actionItems ?? [])[0] ?? `Contact ${doc.issuer} to confirm what they need.`,
      legalOrFinancial: ["official_letter", "contract", "insurance"].includes(doc.type),
    };
  }

  if (system.includes("You write short replies")) {
    // Body only: the app adds "Dear ...," and "Sincerely," itself.
    const doc = documentFromPrompt(prompt, /\n\n(Reference numbers|This document has no reference)/);
    const firm = /Write a firm reply/.test(prompt);
    const goal = (prompt.match(/Goal: (.*)$/m)?.[1] ?? "ask for more time").trim();
    const ref = prompt.match(/^- ([A-Za-z ]+): (\S+)$/m);
    const refText = ref ? ` (${ref[1].toLowerCase()} ${ref[2]})` : "";
    const next = nextDeadline(doc);
    const amount = next?.amount ?? doc.amount;
    const facts = amount !== undefined ? ` The amount is ${money(amount)}${next ? `, due ${next.date}` : ""}.` : "";
    const replyBy = prompt.match(/by ([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1] ?? "next week";
    // Test hooks: "[bad-draft]" in the goal makes the first draft break the rules (invented
    // figure, wrong reference label); "[bad-draft-twice]" breaks the retry too.
    const isRetry = prompt.includes("Your previous draft had these problems");
    if (/\[bad-draft-twice\]/.test(goal) || (/\[bad-draft\]/.test(goal) && !isRetry)) {
      return {
        subject: `Bill number ${ref?.[2] ?? "X-1"}`,
        body: `I dispute this charge. Please give me 30 more days for bill number ${ref?.[2] ?? "X-1"}.`,
      };
    }
    const body = firm
      ? `I am requesting to ${goal} regarding ${doc.title}${refText}.${facts}\n\nPlease confirm in writing by ${replyBy}.`
      : `I am writing about ${doc.title}${refText}.${facts}\n\nI would like to ${goal}. I would be grateful for any options you can offer.\n\nThank you for your understanding.`;
    return { subject: `${firm ? "Formal request" : "Request"}: ${goal} – ${doc.title}`, body };
  }

  return {};
}

// The demo web's agent: pick one tool and its arguments from keywords (the app speaks the
// tool's own sentence, so the model is never asked for a final answer).
function agentTurn(messages, mustUseTool) {
  const last = messages.at(-1);
  const said = (last?.content ?? []).map((block) => block.text ?? "").join(" ");
  const q = said.toLowerCase();

  // Test hook: "[text-first]" answers in text unless a tool call is required (toolChoice any),
  // like Nova 2 Lite sometimes does.
  if (q.includes("[text-first]") && !mustUseTool) return textReply("Sure, let me check that for you.");
  // Test hook: "[text-always]" answers in text even when a tool is required (tests the
  // server-side default call).
  if (q.includes("[text-always]")) return textReply("Sure, let me check that for you.");
  // Test hook: "[bad-input]" calls list_deadlines with a date the server rejects (tests the
  // input validation log and the server-side default call).
  if (q.includes("[bad-input]")) return toolUseReply("list_deadlines", { from: "this month" });
  // Test hook: "[search-only]" calls search_documents, like Nova did for "explain the letter".
  if (q.includes("[search-only]")) return toolUseReply("search_documents", { query: guessQuery(q, "parking") });

  if (/firm|stronger|polite|softer/.test(q)) {
    const previous = [...messages]
      .reverse()
      .flatMap((m) => m.content ?? [])
      .find((block) => block.toolUse?.name === "draft_reply")?.toolUse;
    if (previous) {
      return toolUseReply("draft_reply", { ...previous.input, tone: /firm|stronger/.test(q) ? "firm" : "polite" });
    }
  }
  if (/\b(brief|briefing|weekly|overview)\b/.test(q) || (/summar/.test(q) && /\bweek\b/.test(q))) {
    return toolUseReply("weekly_brief", {});
  }
  if (/warrant/.test(q)) {
    if (/which|all|warranties|active/.test(q)) return toolUseReply("check_warranty", {});
    const product = q.match(/my ([a-z]+)/)?.[1] ?? "dishwasher";
    return toolUseReply("check_warranty", { product });
  }
  if (/higher|lower|usual|normal|compare/.test(q)) {
    const issuer = ["brightwave", "riverside"].find((word) => q.includes(word));
    return toolUseReply("compare_bills", issuer ? { issuer } : { query: guessQuery(q, "") });
  }
  if (/mean|explain|ignore|what is this|what's this|summar/.test(q)) {
    return toolUseReply("explain_document", { query: guessQuery(q, "parking notice"), question: said });
  }
  if (/reply|write|letter|email|extension|draft|cancel/.test(q)) {
    return toolUseReply("draft_reply", {
      query: guessQuery(q, "electricity bill"),
      intent: /cancel/.test(q)
        ? "cancel the membership"
        : /disput/.test(q)
          ? "dispute the electricity bill"
          : "ask for a payment extension",
      tone: /firm/.test(q) ? "firm" : "polite",
    });
  }
  if (/insurance|renew/.test(q)) {
    return toolUseReply("explain_document", { query: guessQuery(q, "car insurance"), question: said });
  }
  if (/pay|due|deadline|coming up|this month|this week|owe|bills?/.test(q)) {
    const input = /pay|owe|bills?/.test(q) ? { payable: true } : {};
    if (q.includes("this month")) Object.assign(input, { from: today(), to: endOfMonth(today()) });
    return toolUseReply("list_deadlines", input);
  }
  // A required tool call with nothing to go on: search with the words said.
  if (mustUseTool) return toolUseReply("search_documents", { query: said.slice(0, 100) || "document" });
  return textReply("I can tell you what's due, explain a letter, check a warranty or draft a reply. What do you need?");
}

function guessQuery(q, fallback) {
  const known = ["electricity", "water", "parking", "insurance", "gym", "membership", "field trip", "school", "dishwasher"];
  return known.find((word) => q.includes(word)) ?? fallback;
}

// ---------- Polly ----------

// A short two-note chime (WAV) instead of real speech.
function chime() {
  const rate = 22050;
  const notes = [659.25, 880];
  const noteSamples = Math.floor(rate * 0.18);
  const samples = new Int16Array(noteSamples * notes.length);
  notes.forEach((freq, n) => {
    for (let i = 0; i < noteSamples; i++) {
      const envelope = Math.min(1, i / 400, (noteSamples - i) / 1200);
      samples[n * noteSamples + i] = Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * envelope * 0.15 * 32767);
    }
  });
  const data = Buffer.from(samples.buffer);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// ---------- HTTP server ----------

function sendJson(res, status, value, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(value));
}

function handler(req, res) {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      return sendJson(res, 400, { message: "Invalid JSON" }, { "x-amzn-ErrorType": "ValidationException" });
    }

    setTimeout(() => {
      if (req.method === "POST" && /^\/model\/[^/]+\/converse$/.test(req.url ?? "")) {
        const reply = converse(body);
        const block = reply.output.message.content[0];
        console.log(`[bedrock] ${block.toolUse ? `toolUse ${block.toolUse.name} ${JSON.stringify(block.toolUse.input).slice(0, 120)}` : `text "${block.text.slice(0, 80)}"`}`);
        return sendJson(res, 200, reply);
      }
      if (req.method === "POST" && req.url === "/v1/speech") {
        if (process.env.MOCK_POLLY === "fail") {
          console.log("[polly] failing on purpose (MOCK_POLLY=fail)");
          return sendJson(res, 503, { message: "Mock Polly is down" }, { "x-amzn-ErrorType": "ServiceFailureException" });
        }
        console.log(`[polly] ${body.VoiceId} (${body.Engine}): "${String(body.Text).slice(0, 80)}"`);
        const audio = chime();
        res.writeHead(200, { "Content-Type": "audio/wav", "x-amzn-RequestCharacters": String(String(body.Text).length) });
        return res.end(audio);
      }
      console.log(`[mock-aws] unknown request ${req.method} ${req.url}`);
      sendJson(res, 404, { message: "Not mocked" }, { "x-amzn-ErrorType": "UnknownOperationException" });
    }, req.url === "/v1/speech" ? 100 : LATENCY_MS);
  });
}

createServer(handler).listen(PORT, () => {
  console.log(`Mock Bedrock + Polly (HTTP/2) listening on http://localhost:${PORT}`);
});
