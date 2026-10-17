import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import type {
  BedrockRuntimeClient,
  Message,
  Tool as BedrockTool,
  ToolConfiguration,
  ToolInputSchema,
  ToolResultContentBlock,
  ToolUseBlock,
} from "@aws-sdk/client-bedrock-runtime";
import type { Tool as McpTool } from "@modelcontextprotocol/client";
import { bedrockModelId, createBedrockClient, toLlmError } from "@/lib/llm/bedrock";
import { addDays, endOfMonth, todayISO } from "@/lib/dates";
import { cleanSpoken } from "@/lib/speech";
import { callMcpTool, listMcpTools } from "./mcpClient";
import type { ToolCallResult } from "./mcpClient";
import type { Card, CardKind, ChatResponse, ChatTurn } from "./types";

// Agent for the Echo Show simulator: Bedrock Converse with tool use, where every tool is one
// of Duly's MCP tools, called through the MCP client (see mcpClient.ts).
// The model only picks the tool and its arguments, in a single call. What Alexa says is the
// tool's own spoken sentence (its first text block): the model never writes the reply, so it
// can't leak ids or JSON, repeat itself or claim actions it didn't take.

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

// "Explain the parking fine letter", "what does it mean", "what happens if I ignore it".
const EXPLAIN_REQUEST = /\b(explain|mean|means|meaning|ignore|what is this|what's this)\b/i;

// Said when the model picks no tool (small talk, unrelated questions).
const HELP_REPLY = "I can tell you what's due, explain a letter, check a warranty or draft a reply. What do you need?";

function systemPrompt(): string {
  const today = todayISO();
  const date = new Date(`${today}T00:00:00Z`);
  const weekday = date.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  // Sunday ends the week.
  const endOfWeek = addDays(today, (7 - date.getUTCDay()) % 7);
  return `You route household-paperwork questions from a kitchen Echo Show to the Duly tools.
Today is ${weekday}, ${today}.
Rules:
- Answer every paperwork question by calling exactly one tool. Your own text is never shown or spoken.
- "What do I need to pay?", "what bills are due?": call list_deadlines with payable: true.
- Periods for list_deadlines: "this month" = from ${today} to ${endOfMonth(today)}; "this week" = from ${today} to ${endOfWeek}. With no period, leave from and to out (next 30 days).
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

  const messages: Message[] = [
    ...history.flatMap((turn, i) => turnToMessages(turn, i, toolNames)),
    { role: "user", content: [{ text: message }] },
  ];

  const toolConfig: ToolConfiguration = { tools: mcpTools.map(toBedrockTool) };
  let toolUses = await pickTools(messages, toolConfig);
  let forced = false;
  if (toolUses.length === 0) {
    // Nova 2 Lite sometimes answers in text even when a tool fits. Ask again, this time
    // requiring a tool call (toolChoice "any", supported by Nova 2 models).
    console.info("[chat] the model picked no tool, retrying with toolChoice any");
    forced = true;
    toolUses = await pickTools(messages, { ...toolConfig, toolChoice: { any: {} } });
  }

  // Run the tools the model picked. No second model call: the tool's sentence is the reply.
  const calls: ToolCallResult[] = [];
  for (const use of toolUses) {
    if (!use.name || !toolNames.has(use.name)) continue;
    calls.push(await safeCallTool(mcpUrl, use.name, (use.input ?? {}) as Record<string, unknown>));
  }

  if (calls.length > 0 && calls.every((call) => call.name === "search_documents")) {
    const matches = (calls.at(-1)?.structuredContent?.matches as { id: string }[] | undefined) ?? [];
    // A forced call that found nothing means the question wasn't about paperwork ("hello").
    if (forced && matches.length === 0) return buildResponse(message, HELP_REPLY, []);
    // Safety net: "explain the parking fine letter" must end in an explanation, not a search hit.
    if (matches.length > 0 && EXPLAIN_REQUEST.test(message) && toolNames.has("explain_document")) {
      calls.push(await safeCallTool(mcpUrl, "explain_document", { document_id: matches[0].id, question: message }));
    }
  }

  const main = mainCall(calls);
  return buildResponse(message, main ? main.text : HELP_REPLY, calls);
}

// One Converse call that only chooses tools and their arguments (temperature 0, as the Nova
// docs recommend for tool calling).
async function pickTools(messages: Message[], toolConfig: ToolConfiguration): Promise<ToolUseBlock[]> {
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
    return (response.output?.message?.content ?? []).flatMap((block) => (block.toolUse ? [block.toolUse] : []));
  } catch (error) {
    throw toLlmError(error);
  }
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

function buildResponse(userText: string, spoken: string, calls: ToolCallResult[]): ChatResponse {
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
  return { reply, cards: cardsFor(calls), turn };
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
  const schema: Record<string, unknown> = { ...tool.inputSchema };
  delete schema.$schema;
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

// Rebuilds an earlier exchange as real Converse messages (tool calls included), so the model
// knows which document and intent "make it firmer" refers to. The document id travels as a
// JSON block, never inside text.
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
        const content: ToolResultContentBlock[] = [{ text: tool.result }];
        if (tool.documentId) content.push({ json: { document_id: tool.documentId } } as ToolResultContentBlock);
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
