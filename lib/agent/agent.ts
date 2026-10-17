import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import type {
  BedrockRuntimeClient,
  ContentBlock,
  Message,
  Tool as BedrockTool,
  ToolInputSchema,
  ToolResultContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import type { Tool as McpTool } from "@modelcontextprotocol/client";
import { bedrockModelId, createBedrockClient, toLlmError } from "@/lib/llm/bedrock";
import { todayISO } from "@/lib/dates";
import { limitSentences } from "@/lib/speech";
import { callMcpTool, listMcpTools } from "./mcpClient";
import type { ToolCallResult } from "./mcpClient";
import type { Card, CardKind, ChatResponse, ChatTurn } from "./types";

// Agent loop for the Echo Show simulator: Bedrock Converse with tool use, where every
// tool is one of Duly's MCP tools, called through the MCP client (see mcpClient.ts).

// Model turns per question: enough for "search, then explain", and stops runaway loops.
const MAX_STEPS = 4;

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

const FALLBACK_REPLY = "Sorry, I couldn't find an answer to that. Try asking about your bills, warranties or letters.";

function systemPrompt(): string {
  const today = todayISO();
  const weekday = new Date(`${today}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  return `You are Alexa+ on a kitchen Echo Show. You answer questions about the household's paperwork (bills, insurance, warranties, official letters, subscriptions, school forms) using the Duly tools.
Today is ${weekday}, ${today}.
Rules:
- Always answer from the tools. Never invent documents, amounts or dates.
- To find a document, pass keywords in "query" (e.g. "parking notice"); you don't need search_documents first.
- Your reply is spoken aloud: 1 to 3 short sentences, no lists, no markdown. The screen already shows lists, documents and letters, so don't read them out.
- Duly explains documents but never gives legal or financial advice.
- To change a draft ("make it firmer"), call draft_reply again with the same document and intent and the new tone.`;
}

let bedrock: BedrockRuntimeClient | undefined;

export async function runAgent(mcpUrl: string, message: string, history: ChatTurn[]): Promise<ChatResponse> {
  const mcpTools = await listMcpTools(mcpUrl);
  const toolNames = new Set(mcpTools.map((tool) => tool.name));
  const toolConfig = { tools: mcpTools.map(toBedrockTool) };

  const messages: Message[] = [
    ...history.flatMap((turn, i) => turnToMessages(turn, i, toolNames)),
    { role: "user", content: [{ text: message }] },
  ];
  const calls: ToolCallResult[] = [];
  let finalText = "";

  bedrock ??= createBedrockClient();
  for (let step = 0; step < MAX_STEPS; step++) {
    let reply: Message | undefined;
    try {
      const response = await bedrock.send(
        new ConverseCommand({
          modelId: bedrockModelId(),
          system: [{ text: systemPrompt() }],
          messages,
          toolConfig,
          inferenceConfig: { temperature: 0.2, maxTokens: 600 },
        }),
      );
      reply = response.output?.message;
    } catch (error) {
      throw toLlmError(error);
    }
    if (!reply) break;
    messages.push(reply);

    const toolUses = (reply.content ?? []).flatMap((block) => (block.toolUse ? [block.toolUse] : []));
    if (toolUses.length === 0) {
      finalText = textOf(reply.content);
      break;
    }

    // Run every tool the model asked for, then hand the results back to it.
    const results: ContentBlock[] = [];
    for (const use of toolUses) {
      const result = await safeCallTool(mcpUrl, use.name ?? "", (use.input ?? {}) as Record<string, unknown>);
      calls.push(result);
      results.push({
        toolResult: {
          toolUseId: use.toolUseId,
          status: result.isError ? "error" : "success",
          content: toolResultContent(result),
        },
      });
    }
    messages.push({ role: "user", content: results });
  }

  // If the model said nothing (or ran out of steps), speak the last tool's sentence.
  const spoken = finalText || calls.at(-1)?.text || FALLBACK_REPLY;
  return buildResponse(message, limitSentences(spoken, 3), calls);
}

// The page calls list_deadlines and add_document directly (no model involved).
export async function runDirectTool(
  mcpUrl: string,
  name: string,
  input: Record<string, unknown>,
  userText: string,
): Promise<ChatResponse> {
  const result = await safeCallTool(mcpUrl, name, input);
  return buildResponse(userText, result.text, [result]);
}

function buildResponse(userText: string, reply: string, calls: ToolCallResult[]): ChatResponse {
  const turn: ChatTurn = {
    user: userText,
    assistant: reply,
    // The base64 file is never sent back to the page.
    tools: calls.map((call) => ({ name: call.name, input: withoutFile(call.input), result: historyResult(call) })),
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

function toolResultContent(result: ToolCallResult): ToolResultContentBlock[] {
  const content: ToolResultContentBlock[] = [{ text: result.text }];
  if (result.structuredContent) {
    content.push({ json: result.structuredContent } as ToolResultContentBlock);
  }
  return content;
}

// Rebuilds an earlier exchange as real Converse messages (tool calls included),
// so the model knows which document and intent "make it firmer" refers to.
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
      content: tools.map((tool, j) => ({ toolResult: { toolUseId: id(j), content: [{ text: tool.result }] } })),
    });
  }
  messages.push({ role: "assistant", content: [{ text: turn.assistant || "OK." }] });
  return messages;
}

// Nova models sometimes wrap their reasoning in <thinking> tags: never speak it.
function textOf(content: ContentBlock[] | undefined): string {
  return (content ?? [])
    .map((block) => block.text ?? "")
    .join(" ")
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// The spoken sentence, plus the document id when there is one, so a follow-up like
// "what does this letter mean?" right after an upload can find the document.
function historyResult(call: ToolCallResult): string {
  const document = call.structuredContent?.document as { id?: unknown } | undefined;
  return typeof document?.id === "string" ? `${call.text} (document_id: ${document.id})` : call.text;
}

function withoutFile(input: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...input };
  for (const field of MODEL_HIDDEN_FIELDS) delete copy[field];
  return copy;
}
