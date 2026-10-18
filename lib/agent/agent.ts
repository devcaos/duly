import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import type {
  BedrockRuntimeClient,
  Message,
  StopReason,
  Tool as BedrockTool,
  ToolConfiguration,
  ToolInputSchema,
  ToolResultContentBlock,
  ToolUseBlock,
} from "@aws-sdk/client-bedrock-runtime";
import type { Tool as McpTool } from "@modelcontextprotocol/client";
import { bedrockModelId, createBedrockClient, toLlmError } from "@/lib/llm/bedrock";
import { periodRange, todayISO } from "@/lib/dates";
import { cleanSpoken } from "@/lib/speech";
import { callMcpTool, listMcpTools } from "./mcpClient";
import type { ToolCallResult } from "./mcpClient";
import type { Card, CardKind, ChatResponse, ChatRoute, ChatTurn } from "./types";

// Agent for the Echo Show simulator: Bedrock Converse with tool use, where every tool is one
// of Duly's MCP tools, called through the MCP client (see mcpClient.ts).
// The model only picks the tool and its arguments, in a single call. What Alexa says is the
// tool's own sentence (its first text block): the model never writes the reply, so it can't
// leak ids or JSON, repeat itself or claim actions it didn't take.
// If Nova answers in text instead of calling a tool, the agent asks again requiring the tool
// that the message's keywords point to, and as a last resort calls that tool itself.

const CARD_FOR_TOOL: Record<string, CardKind> = {
  list_deadlines: "deadlines",
  add_document: "document",
  check_warranty: "warranty",
  draft_reply: "draft",
  explain_document: "explanation",
  search_documents: "matches",
};

// Files only arrive through the upload button, so the model never sees these fields.
const MODEL_HIDDEN_FIELDS = ["file_base64", "mime_type"];

// JSON Schema keywords sent to Nova. Its tool schemas should stay flat and simple, so patterns,
// lengths and the like are left out; the MCP server still validates the full zod schema.
const NOVA_SCHEMA_KEYS = new Set(["type", "description", "properties", "required", "enum", "items"]);

// "Explain the parking fine letter", "what does it mean", "what happens if I ignore it".
const EXPLAIN_REQUEST = /\b(explain|mean|means|meaning|ignore|what is this|what's this)\b/i;

// The tool a message's keywords point to. Action intents come before topics: "write a reply
// about my dishwasher warranty" is a draft, "explain my electricity bill" an explanation.
// "letter" alone isn't a draft keyword, or "explain the parking fine letter" would be a draft.
const KEYWORD_TOOLS: [RegExp, string][] = [
  [/\b(reply|draft|write|firmer|polite)\b/i, "draft_reply"],
  [EXPLAIN_REQUEST, "explain_document"],
  [/\b(warranty|warranties|guarantee)\b/i, "check_warranty"],
  [/\b(pay|owe|due|bills?|deadlines?|renew|renews|renewal)\b/i, "list_deadlines"],
];

// The message talks about the document from the previous turn ("what does it mean?").
const FOLLOW_UP = /\b(it|this|that)\b/i;
// "Make it firmer", "make it more polite": a new tone for the last draft.
const REFINE_DRAFT = /\b(make it|firmer|more polite)\b/i;

// Said when the model picks no tool (small talk, unrelated questions).
const HELP_REPLY = "I can tell you what's due, explain a letter, check a warranty or draft a reply. What do you need?";

function systemPrompt(): string {
  const today = todayISO();
  const weekday = new Date(`${today}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const month = periodRange("month", today);
  const week = periodRange("week", today);
  return `You route household-paperwork questions from a kitchen Echo Show to the Duly tools.
Today is ${weekday}, ${today}.
Rules:
- Answer every paperwork question by calling exactly one tool. Your own text is never shown or spoken.
- "What do I need to pay?", "what bills are due?": call list_deadlines with payable: true.
- Periods for list_deadlines: "this month" = from ${month.from} to ${month.to}; "this week" = from ${week.from} to ${week.to}. With no period, leave from and to out (next 30 days).
- "Explain the ... letter", "what does it mean?", "what happens if I ignore it?": call explain_document with keywords in "query" (or the sender in "issuer"). Never call search_documents for this.
- "Is my <product> under warranty?": check_warranty with product. "Which warranties are still active?", "my warranties": check_warranty without product.
- Use search_documents only when the user asks to find or list documents.
- explain_document, draft_reply and check_warranty find the document themselves from "query" (e.g. "parking notice"); you don't need search_documents first.
- To change a draft ("make it firmer", "make it more polite"), call draft_reply again with the same document_id and intent from the earlier call and the new tone.
- Never invent document ids: use one from an earlier tool result, or use "query".`;
}

let bedrock: BedrockRuntimeClient | undefined;

export async function runAgent(mcpUrl: string, message: string, history: ChatTurn[]): Promise<ChatResponse> {
  const mcpTools = await listMcpTools(mcpUrl);
  const toolNames = new Set(mcpTools.map((tool) => tool.name));
  const keywordTool = KEYWORD_TOOLS.find(([pattern, name]) => pattern.test(message) && toolNames.has(name))?.[1];

  const messages: Message[] = [
    ...history.flatMap((turn, i) => turnToMessages(turn, i, toolNames)),
    { role: "user", content: [{ text: message }] },
  ];

  // Why the route isn't "model", for the log.
  const notes: string[] = [];
  let route: ChatRoute = "model";
  const toolConfig: ToolConfiguration = { tools: mcpTools.map(toBedrockTool) };
  let picked = await pickTools(messages, toolConfig);
  if (picked.toolUses.length === 0) {
    // Nova 2 Lite sometimes answers in text even when a tool fits. Ask again requiring the
    // keyword tool (Nova then only fills its arguments), or any tool if no keyword matched.
    notes.push(`model answered in text (stop ${picked.stopReason})`);
    route = keywordTool ? "forced-keyword" : "forced-any";
    picked = await pickTools(messages, {
      ...toolConfig,
      toolChoice: keywordTool ? { tool: { name: keywordTool } } : { any: {} },
    });
    if (picked.toolUses.length === 0) notes.push(`forced call answered in text (stop ${picked.stopReason})`);
  }

  // Run the tools the model picked. No second model call: the tool's sentence is the reply.
  const calls: ToolCallResult[] = [];
  for (const use of picked.toolUses) {
    if (!use.name || !toolNames.has(use.name)) {
      notes.push(`unknown tool ${use.name}`);
      continue;
    }
    const input = (use.input ?? {}) as Record<string, unknown>;
    const call = await safeCallTool(mcpUrl, use.name, input);
    if (isInputRejected(call)) {
      // Logged and skipped: the fallback below calls the tool with arguments that are valid.
      console.warn(`[chat] ${use.name} rejected the model's input (keys: ${Object.keys(input).join(", ") || "none"})`);
      notes.push(`${use.name} rejected the input`);
      continue;
    }
    if (call.isError && route !== "model") {
      // A forced call often comes with thin arguments ("explain_document" with no query).
      notes.push(`forced ${use.name} call failed`);
      continue;
    }
    calls.push(call);
  }

  if (calls.length === 0 && keywordTool) {
    // Nova still gave nothing usable: call the keyword tool ourselves with default arguments.
    route = "server-default";
    calls.push(await safeCallTool(mcpUrl, keywordTool, defaultInput(keywordTool, message, history)));
  }

  if (calls.length > 0 && calls.every((call) => call.name === "search_documents")) {
    const matches = (calls.at(-1)?.structuredContent?.matches as { id: string }[] | undefined) ?? [];
    // A forced call with no keyword to go on that found nothing: the question wasn't about
    // paperwork ("hello").
    if (route === "forced-any" && matches.length === 0) {
      logRoute(undefined, route, [...notes, "search found nothing"]);
      return buildResponse(message, HELP_REPLY, [], route);
    }
    // Safety net: "explain the parking fine letter" must end in an explanation, not a search hit.
    if (matches.length > 0 && EXPLAIN_REQUEST.test(message) && toolNames.has("explain_document")) {
      notes.push("search hit turned into an explanation");
      calls.push(await safeCallTool(mcpUrl, "explain_document", { document_id: matches[0].id, question: message }));
    }
  }

  const main = mainCall(calls);
  logRoute(main?.name, route, notes);
  return buildResponse(message, main ? main.text : HELP_REPLY, calls, route);
}

// One Converse call that only chooses tools and their arguments (temperature 0, as the Nova
// docs recommend for tool calling).
async function pickTools(
  messages: Message[],
  toolConfig: ToolConfiguration,
): Promise<{ toolUses: ToolUseBlock[]; stopReason?: StopReason }> {
  bedrock ??= createBedrockClient();
  try {
    const response = await bedrock.send(
      new ConverseCommand({
        modelId: bedrockModelId(),
        system: [{ text: systemPrompt() }],
        messages,
        toolConfig,
        inferenceConfig: { temperature: 0, maxTokens: 500 },
      }),
    );
    const content = response.output?.message?.content ?? [];
    return {
      toolUses: content.flatMap((block) => (block.toolUse ? [block.toolUse] : [])),
      stopReason: response.stopReason,
    };
  } catch (error) {
    throw toLlmError(error);
  }
}

// Arguments for the server-side fallback, taken from the message and the conversation.
function defaultInput(tool: string, message: string, history: ChatTurn[]): Record<string, unknown> {
  const earlierTools = history.flatMap((turn) => turn.tools);
  switch (tool) {
    case "check_warranty":
      return {}; // every warranty with its status
    case "list_deadlines": {
      const period = /\bthis week\b/i.test(message)
        ? periodRange("week")
        : /\bthis month\b/i.test(message)
          ? periodRange("month")
          : {};
      return { payable: true, ...period };
    }
    case "explain_document": {
      const documentId = FOLLOW_UP.test(message) ? earlierTools.findLast((t) => t.documentId)?.documentId : undefined;
      // Without a document id, explain_document searches with the question itself.
      return documentId ? { document_id: documentId, question: message } : { question: message };
    }
    case "draft_reply": {
      const tone = /\bfirm/i.test(message) ? "firm" : /\bpolite/i.test(message) ? "polite" : undefined;
      const lastDraft = earlierTools.findLast((t) => t.name === "draft_reply");
      // "Make it firmer": same document and intent as the last draft, new tone.
      if (lastDraft && REFINE_DRAFT.test(message)) {
        return { ...lastDraft.input, document_id: lastDraft.documentId ?? lastDraft.input.document_id, tone };
      }
      // "Write a reply to it": the document from the previous turn.
      const documentId = FOLLOW_UP.test(message) ? earlierTools.findLast((t) => t.documentId)?.documentId : undefined;
      return documentId
        ? { document_id: documentId, intent: message, tone }
        : { query: message, intent: message, tone };
    }
    default:
      return {};
  }
}

// The MCP server answers invalid arguments with an error result, not a protocol error.
function isInputRejected(call: ToolCallResult): boolean {
  return call.isError && call.text.startsWith("Input validation error");
}

// One line per question. Only tool names and reasons: never arguments, documents or secrets.
function logRoute(tool: string | undefined, route: ChatRoute, notes: string[]) {
  console.info(`[chat] tool=${tool ?? "none"} via=${route}${notes.length > 0 ? ` (${notes.join("; ")})` : ""}`);
}

// The page calls list_deadlines, add_document and draft_reply ("Make it firmer") directly.
export async function runDirectTool(
  mcpUrl: string,
  name: string,
  input: Record<string, unknown>,
  userText: string,
): Promise<ChatResponse> {
  const result = await safeCallTool(mcpUrl, name, input);
  return buildResponse(userText, result.text, [result]);
}

// The call whose sentence is spoken: the last one that isn't a plain search, if any.
function mainCall(calls: ToolCallResult[]): ToolCallResult | undefined {
  return calls.findLast((call) => call.name !== "search_documents") ?? calls.at(-1);
}

function buildResponse(userText: string, spoken: string, calls: ToolCallResult[], route?: ChatRoute): ChatResponse {
  const reply = cleanSpoken(spoken) || HELP_REPLY;
  const turn: ChatTurn = {
    user: userText,
    assistant: reply,
    tools: calls.map((call) => ({
      name: call.name,
      // The base64 file is never sent back to the page.
      input: withoutFile(call.input),
      result: cleanSpoken(call.text),
      documentId: documentIdOf(call),
    })),
  };
  return { reply, cards: cardsFor(calls), turn, route };
}

// One card per tool (the latest call wins). Search results only show when nothing else did.
function cardsFor(calls: ToolCallResult[]): Card[] {
  const latest = new Map<string, Card>();
  for (const call of calls) {
    const kind = CARD_FOR_TOOL[call.name];
    if (!kind || call.isError || !call.structuredContent) continue;
    latest.delete(call.name);
    latest.set(call.name, { kind, data: call.structuredContent });
  }
  const cards = [...latest.values()];
  const main = cards.filter((card) => card.kind !== "matches");
  return main.length > 0 ? main : cards;
}

async function safeCallTool(mcpUrl: string, name: string, input: Record<string, unknown>): Promise<ToolCallResult> {
  try {
    return await callMcpTool(mcpUrl, name, input);
  } catch (error) {
    console.error(`[chat] MCP tool ${name} failed (${error instanceof Error ? error.message : error})`);
    return { name, input, text: "Duly didn't answer. Please try again in a moment.", isError: true };
  }
}

function toBedrockTool(tool: McpTool): BedrockTool {
  const schema = novaSchema(tool.inputSchema as Record<string, unknown>);
  const properties = { ...(schema.properties as Record<string, unknown> | undefined) };
  for (const field of MODEL_HIDDEN_FIELDS) delete properties[field];
  schema.properties = properties;
  return {
    toolSpec: {
      name: tool.name,
      description: tool.description ?? tool.title ?? tool.name,
      inputSchema: { json: schema } as ToolInputSchema,
    },
  };
}

// Keeps only the keywords in NOVA_SCHEMA_KEYS, recursively, and gives every object a
// `required` list (empty when all its fields are optional).
function novaSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!NOVA_SCHEMA_KEYS.has(key)) continue;
    if (key === "properties") {
      const properties = Object.entries(value as Record<string, Record<string, unknown>>);
      clean.properties = Object.fromEntries(properties.map(([name, field]) => [name, novaSchema(field)]));
    } else if (key === "items") {
      clean.items = novaSchema(value as Record<string, unknown>);
    } else {
      clean[key] = value;
    }
  }
  if (clean.type === "object") clean.required ??= [];
  return clean;
}

// Rebuilds an earlier exchange as real Converse messages (tool calls included), so the model
// knows which document and intent "make it firmer" refers to.
// A Nova tool result must be either one JSON block or text: with a mix of text and JSON,
// Bedrock silently drops the tools from the request and Nova answers in text (FRICTION.md).
// So a result with a document is one JSON block that carries both the sentence and the id.
function turnToMessages(turn: ChatTurn, index: number, toolNames: Set<string>): Message[] {
  const tools = turn.tools.filter((tool) => toolNames.has(tool.name));
  const messages: Message[] = [{ role: "user", content: [{ text: turn.user || "(uploaded a document)" }] }];
  if (tools.length > 0) {
    const id = (j: number) => `history-${index}-${j}`;
    messages.push({
      role: "assistant",
      content: tools.map((tool, j) => ({ toolUse: { toolUseId: id(j), name: tool.name, input: tool.input } })),
    } as Message);
    messages.push({
      role: "user",
      content: tools.map((tool, j) => {
        const content: ToolResultContentBlock[] = tool.documentId
          ? [{ json: { result: tool.result, document_id: tool.documentId } } as ToolResultContentBlock]
          : [{ text: tool.result }];
        return { toolResult: { toolUseId: id(j), content } };
      }),
    });
  }
  messages.push({ role: "assistant", content: [{ text: turn.assistant || "OK." }] });
  return messages;
}

function documentIdOf(call: ToolCallResult): string | undefined {
  const document = call.structuredContent?.document as { id?: unknown } | undefined;
  return typeof document?.id === "string" ? document.id : undefined;
}

function withoutFile(input: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...input };
  for (const field of MODEL_HIDDEN_FIELDS) delete copy[field];
  return copy;
}
