// Calls every Duly MCP tool against a running server and prints the results.
// Usage:
//   npm run dev                              (in another terminal)
//   npm run tools                            (text-only tests)
//   npm run tools -- path/to/document.png    (also test add_document with a file)
// Set MCP_URL to test another server, e.g. the Vercel deployment.

import { readFileSync } from "node:fs";
import { extname } from "node:path";

const MCP_URL = process.env.MCP_URL ?? "http://localhost:3000/api/mcp";
const PROTOCOL_VERSION = "2025-11-25";
const MIME_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".pdf": "application/pdf" };

let nextId = 1;

async function rpc(method, params) {
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": PROTOCOL_VERSION,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);

  // The answer is either plain JSON or a Server-Sent Events stream with "data:" lines.
  const json = body.trimStart().startsWith("{")
    ? body
    : body
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .at(-1);
  const message = JSON.parse(json);
  if (message.error) throw new Error(`${message.error.code}: ${message.error.message}`);
  return message.result;
}

function short(value, max = 600) {
  const text = JSON.stringify(value, null, 2) ?? "";
  return text.length > max ? `${text.slice(0, max)}\n  ... (${text.length - max} more characters)` : text;
}

async function callTool(name, args) {
  console.log(`\n=== ${name} ${JSON.stringify(args, (k, v) => (k === "file_base64" ? "<base64>" : v))}`);
  const started = Date.now();
  try {
    const result = await rpc("tools/call", { name, arguments: args });
    // Block 1 is the spoken sentence; block 2 (if any) is the JSON copy of structuredContent.
    const blocks = result.content ?? [];
    const label = result.isError ? "ERROR" : "Spoken";
    console.log(`${label} (${Date.now() - started} ms, ${blocks.length} content blocks): ${blocks[0]?.text}`);
    if (result.structuredContent) console.log(short(result.structuredContent));
    return result;
  } catch (error) {
    console.log(`FAILED: ${error.message}`);
  }
}

const SAMPLE_LETTER = `SAMPLE - Riverside Water Company
Water bill, account RW-1180-33
Billing period: last month. Usage: 9,200 gallons.
Amount due: $56.75. Please pay within 14 days of this letter.
A late fee of $5.00 will be added after the due date.
Questions? Call 1-800-555-0190.`;

async function main() {
  console.log(`MCP server: ${MCP_URL}`);
  const init = await rpc("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "duly-call-tools", version: "1.0.0" },
  });
  console.log(`Connected to ${init.serverInfo.name} ${init.serverInfo.version} (protocol ${init.protocolVersion})`);

  const { tools } = await rpc("tools/list", {});
  console.log(`Tools: ${tools.map((t) => t.name).join(", ")}`);

  await callTool("list_deadlines", {});
  await callTool("list_deadlines", { payable: true });
  await callTool("check_warranty", { product: "dishwasher" });
  await callTool("check_warranty", {});
  await callTool("search_documents", { query: "car insurance" });
  await callTool("add_document", { text: SAMPLE_LETTER });
  await callTool("list_deadlines", { kind: "payment_due" });
  await callTool("explain_document", { query: "parking", question: "What happens if I ignore it?" });
  await callTool("explain_document", { issuer: "City of Maplewood" });
  await callTool("draft_reply", { query: "electricity", intent: "ask for a payment extension of two weeks" });
  await callTool("draft_reply", { issuer: "Brightwave Energy", intent: "ask for a payment extension", tone: "firm" });

  const filePath = process.argv[2];
  if (filePath) {
    const mimeType = MIME_TYPES[extname(filePath).toLowerCase()];
    if (!mimeType) {
      console.log(`\nSkipping ${filePath}: use a .png, .jpg or .pdf file.`);
    } else {
      const file_base64 = readFileSync(filePath).toString("base64");
      await callTool("add_document", { file_base64, mime_type: mimeType });
    }
  }
}

main().catch((error) => {
  console.error(`\nCould not talk to the server: ${error.message}`);
  console.error("Is it running? Start it with: npm run dev");
  process.exit(1);
});
