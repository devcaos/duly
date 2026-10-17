import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { DEADLINE_KINDS } from "@/lib/types";
import type { ToolResult } from "@/lib/types";
import { summarizeError } from "@/lib/aws";
import { LlmError } from "@/lib/llm";
import { ToolError } from "@/lib/tools/resolveDocument";
import { listDeadlinesOutput, runListDeadlines } from "@/lib/tools/listDeadlines";
import { checkWarrantyOutput, runCheckWarranty } from "@/lib/tools/checkWarranty";
import { runSearchDocuments, searchDocumentsOutput } from "@/lib/tools/searchDocuments";
import { addDocumentOutput, runAddDocument } from "@/lib/tools/addDocument";
import { explainDocumentOutput, runExplainDocument } from "@/lib/tools/explainDocument";
import { draftReplyOutput, runDraftReply, TONES } from "@/lib/tools/draftReply";
import {
  allowRequest,
  getClientIp,
  isInternalRequest,
  llmLimitPerMinute,
  requestLimitPerMinute,
} from "@/lib/rateLimit";
import { cleanSpoken } from "@/lib/speech";
import {
  isoDateSchema as isoDate,
  MAX_BASE64_CHARS,
  MAX_ID_CHARS,
  MAX_PRODUCT_CHARS,
  MAX_TEXT_CHARS,
  shortText,
} from "@/lib/schemas";

// Vercel stops the function after this many seconds. LLM tools take a few seconds
// (two attempts at most), so 60 s is plenty and stops a stuck call early.
export const maxDuration = 60;

const documentId = () => z.string().max(MAX_ID_CHARS);

// Spoken text for voice (passed through cleanSpoken: no ids, raw JSON or ISO dates)
// + full data for screens (SPEC.md section 4).
// The MCP spec says a tool returning structuredContent SHOULD also return it
// serialized as JSON in a text block, for clients that only read text content.
function toMcpResult<T extends object>(result: ToolResult<T>) {
  return {
    content: [
      { type: "text" as const, text: cleanSpoken(result.text) },
      { type: "text" as const, text: JSON.stringify(result.structuredContent) },
    ],
    structuredContent: result.structuredContent as Record<string, unknown>,
  };
}

function toMcpError(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

// Runs a tool and turns known errors into a short spoken message instead of a crash.
async function runTool<T extends object>(run: () => Promise<ToolResult<T>>) {
  try {
    return toMcpResult(await run());
  } catch (error) {
    if (error instanceof ToolError || error instanceof LlmError) return toMcpError(error.message);
    // Summary only: raw AWS errors can contain ARNs, account IDs and request IDs.
    console.error(`Tool failed (${summarizeError(error)})`);
    return toMcpError("Something went wrong on my side. Please try again.");
  }
}

// Same as runTool, but first applies the per-IP limit for tools that call the LLM.
// The demo web's internal calls skip it: /api/chat already limits each user.
async function runLlmTool<T extends object>(req: Request | undefined, run: () => Promise<ToolResult<T>>) {
  if (!isInternalRequest(req) && !allowRequest("llm", getClientIp(req), llmLimitPerMinute())) {
    return toMcpError("You've used the AI tools a lot in the last minute. Please wait a moment and try again.");
  }
  return runTool(run);
}

const mcpHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      "add_document",
      {
        title: "Add document",
        description:
          "Save a household document (bill, insurance, warranty, official letter, contract, subscription, school form). Send its text, or a photo/PDF as base64. Extracts type, issuer, amounts, deadlines and action items, stores it, and confirms in one sentence.",
        inputSchema: z.object({
          text: z.string().max(MAX_TEXT_CHARS).optional().describe("The document's text, if available."),
          file_base64: z
            .string()
            .max(MAX_BASE64_CHARS)
            .optional()
            .describe("Photo or PDF of the document, base64-encoded (max 3 MB)."),
          mime_type: z
            .enum(["image/jpeg", "image/png", "application/pdf"])
            .optional()
            .describe("Required when file_base64 is sent."),
          hint: shortText().optional().describe("Optional hint, e.g. 'this is my car insurance'."),
        }),
        outputSchema: addDocumentOutput,
      },
      async (input, ctx) => runLlmTool(ctx.http?.req, () => runAddDocument(input)),
    );

    server.registerTool(
      "list_deadlines",
      {
        title: "List deadlines",
        description:
          "List upcoming household deadlines (payments, renewals, reply-by dates, warranty ends, appointments) sorted by date, with amounts and days left. Defaults to today through the next 30 days. For \"what do I need to pay?\" use payable: true: it returns every deadline with an amount (bills, renewals, fees), not only payment_due.",
        inputSchema: z.object({
          from: isoDate.optional().describe("Start date (YYYY-MM-DD). Default: today."),
          to: isoDate.optional().describe("End date (YYYY-MM-DD). Default: 30 days after `from`."),
          kind: z
            .enum(DEADLINE_KINDS)
            .optional()
            .describe("Only return deadlines of this kind. For questions about paying, use payable instead."),
          payable: z
            .boolean()
            .optional()
            .describe("Only deadlines with an amount to pay (bills, renewals, fees). Use for 'what do I need to pay?'."),
        }),
        outputSchema: listDeadlinesOutput,
        annotations: { readOnlyHint: true },
      },
      async (input) => runTool(() => runListDeadlines(input)),
    );

    server.registerTool(
      "explain_document",
      {
        title: "Explain document",
        description:
          "Explain a stored document in plain language: what it means, what happens if it's ignored, and the recommended next step. Use it for \"explain the parking letter\", \"what does this letter mean?\", \"what happens if I ignore it?\" or any question about one document. It finds the document itself from keywords (query) or the sender (issuer); no need to search first. document_id is optional.",
        inputSchema: z.object({
          document_id: documentId().optional().describe("Document id, if already known from an earlier result."),
          query: shortText().optional().describe("Keywords to find the document, e.g. 'parking fine letter'."),
          issuer: shortText().optional().describe("Who sent the document, e.g. 'City of Maplewood'."),
          question: shortText().optional().describe("The user's question, e.g. 'What happens if I ignore it?'"),
        }),
        outputSchema: explainDocumentOutput,
        annotations: { readOnlyHint: true },
      },
      async (input, ctx) => runLlmTool(ctx.http?.req, () => runExplainDocument(input)),
    );

    server.registerTool(
      "check_warranty",
      {
        title: "Check warranty",
        description:
          "Check whether a product (e.g. 'dishwasher') is still under warranty: end date, days remaining and how to claim. Omit product to list all warranties with their status (active, expiring soon, expired), e.g. for \"which of my warranties are still active?\".",
        inputSchema: z.object({
          product: z
            .string()
            .max(MAX_PRODUCT_CHARS)
            .optional()
            .describe("Product name, e.g. 'dishwasher'. Leave it out to list every warranty."),
        }),
        outputSchema: checkWarrantyOutput,
        annotations: { readOnlyHint: true },
      },
      async (input) => runTool(() => runCheckWarranty(input)),
    );

    server.registerTool(
      "draft_reply",
      {
        title: "Draft reply",
        description:
          "Draft a short letter or email replying to a stored document (e.g. ask for a payment extension, cancel a subscription, appeal a fine), using the document's real numbers and dates. It finds the document itself from keywords (query) or the sender (issuer); no need to search first.",
        inputSchema: z.object({
          document_id: documentId().optional().describe("Document id from search_documents or list_deadlines."),
          query: shortText().optional().describe("Keywords to find the document, e.g. 'electricity bill'."),
          issuer: shortText().optional().describe("Who sent the document, e.g. 'Brightwave Energy'."),
          intent: shortText().min(1).describe("What the reply should achieve, e.g. 'ask for a payment extension'."),
          tone: z.enum(TONES).optional().describe("Default: polite."),
        }),
        outputSchema: draftReplyOutput,
        annotations: { readOnlyHint: true },
      },
      async (input, ctx) => runLlmTool(ctx.http?.req, () => runDraftReply(input)),
    );

    server.registerTool(
      "search_documents",
      {
        title: "Search documents",
        description:
          "Search the household's stored documents (bills, insurance, warranties, letters...) by keywords. Returns the top matches with id, title, issuer and type. Only for finding or listing documents: don't call it before explain_document, draft_reply or check_warranty, which find the document themselves.",
        inputSchema: z.object({
          query: shortText().min(1).describe("Keywords, e.g. 'car insurance'."),
        }),
        outputSchema: searchDocumentsOutput,
        annotations: { readOnlyHint: true },
      },
      async (input) => runTool(() => runSearchDocuments(input)),
    );
  },
  {
    serverInfo: { name: "duly", version: "0.2.0" },
    // Duly's tool list never changes. Advertising listChanged: false makes the SDK answer a
    // 2026-07-28 `subscriptions/listen` request and close its SSE stream right away. With the
    // default (true) the stream stays open forever and Vercel kills it after maxDuration.
    capabilities: { tools: { listChanged: false } },
  },
);

// Per-IP limit on every request to /api/mcp (see lib/rateLimit.ts), except the demo web's
// internal calls (signed with DULY_INTERNAL_TOKEN), which /api/chat limits per user instead.
async function handler(req: Request): Promise<Response> {
  if (!isInternalRequest(req) && !allowRequest("all", getClientIp(req), requestLimitPerMinute())) {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: "Too many requests. Please wait a minute and try again." },
      },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }
  return mcpHandler(req);
}

export { handler as GET, handler as POST };
