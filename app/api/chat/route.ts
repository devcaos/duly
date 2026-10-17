import { z } from "zod";
import { runAgent, runDirectTool } from "@/lib/agent/agent";
import { DIRECT_TOOLS, MAX_HISTORY_TURNS, MAX_MESSAGE_CHARS } from "@/lib/agent/types";
import { LlmError } from "@/lib/llm";
import { summarizeError } from "@/lib/aws";
import { allowRequest, getClientIp, llmLimitPerMinute, requestLimitPerMinute } from "@/lib/rateLimit";

// Backend of the Echo Show simulator (SPEC.md section 7). Two kinds of request:
// - { message, history }: the Bedrock agent answers, calling Duly's MCP tools.
// - { call: { name, arguments } }: the page calls list_deadlines, add_document or
//   draft_reply ("Make it firmer") directly.

// A question is one model call plus, for explain and draft, an LLM tool.
export const maxDuration = 60;

// A 3 MB file is about 4 MB as base64, plus a little JSON around it.
const MAX_BODY_CHARS = 4_300_000;

const turnSchema = z.object({
  user: z.string().max(MAX_MESSAGE_CHARS),
  assistant: z.string().max(2000),
  tools: z
    .array(
      z.object({
        name: z.string().max(64),
        input: z.record(z.string(), z.unknown()),
        result: z.string().max(2000),
        documentId: z.string().max(100).optional(),
      }),
    )
    .max(4),
});

const bodySchema = z.union([
  z.object({
    message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
    history: z.array(turnSchema).max(MAX_HISTORY_TURNS).default([]),
  }),
  z.object({
    call: z.object({
      name: z.enum(DIRECT_TOOLS),
      arguments: z.record(z.string(), z.unknown()).default({}),
    }),
  }),
]);

// What the user "said", for the screen and the conversation history.
const DIRECT_USER_TEXT: Record<(typeof DIRECT_TOOLS)[number], string> = {
  list_deadlines: "",
  add_document: "Save this document.",
  draft_reply: "Make it firmer.",
};

// Our own MCP endpoint. MCP_URL overrides it (e.g. to test the deployed server).
function mcpUrl(req: Request): string {
  return process.env.MCP_URL || new URL("/api/mcp", req.url).toString();
}

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) return errorResponse("That file is too big. The limit is 3 MB.", 413);

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return errorResponse("Invalid JSON.", 400);
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return errorResponse("Invalid request.", 400);
  const body = parsed.data;

  // Questions, uploads and drafts use the LLM; the home screen's deadline list doesn't.
  // These limits use the visitor's own IP; the calls to /api/mcp below carry the internal
  // token so they don't count against the server's shared IP there.
  const usesLlm = "message" in body || body.call.name !== "list_deadlines";
  const allowed = usesLlm
    ? allowRequest("chat", getClientIp(req), llmLimitPerMinute())
    : allowRequest("chat-read", getClientIp(req), requestLimitPerMinute());
  if (!allowed) return errorResponse("You've asked a lot in the last minute. Please wait a moment.", 429);

  try {
    if ("message" in body) {
      return Response.json(await runAgent(mcpUrl(req), body.message, body.history));
    }
    const userText = DIRECT_USER_TEXT[body.call.name];
    return Response.json(await runDirectTool(mcpUrl(req), body.call.name, body.call.arguments, userText));
  } catch (error) {
    if (error instanceof LlmError) return errorResponse(error.message, 502);
    console.error(`[chat] failed (${summarizeError(error)})`);
    return errorResponse("Something went wrong on my side. Please try again.", 500);
  }
}
