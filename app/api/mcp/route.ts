import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { DEADLINE_KINDS } from "@/lib/types";
import type { ToolResult } from "@/lib/types";
import { LlmError } from "@/lib/llm";
import { ToolError } from "@/lib/tools/resolveDocument";
import { runListDeadlines } from "@/lib/tools/listDeadlines";
import { runCheckWarranty } from "@/lib/tools/checkWarranty";
import { runSearchDocuments } from "@/lib/tools/searchDocuments";
import { runAddDocument } from "@/lib/tools/addDocument";
import { runExplainDocument } from "@/lib/tools/explainDocument";
import { runDraftReply } from "@/lib/tools/draftReply";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD");

// Spoken text for voice + full data for screens (SPEC.md section 4).
function toMcpResult<T extends object>(result: ToolResult<T>) {
  return {
    content: [{ type: "text" as const, text: result.text }],
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
    console.error("Tool failed:", error);
    return toMcpError("Something went wrong on my side. Please try again.");
  }
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "add_document",
      {
        title: "Add document",
        description:
          "Save a household document (bill, insurance, warranty, official letter, contract, subscription, school form). Send its text, or a photo/PDF as base64. Extracts type, issuer, amounts, deadlines and action items, stores it, and confirms in one sentence.",
        inputSchema: z.object({
          text: z.string().optional().describe("The document's text, if available."),
          file_base64: z.string().optional().describe("Photo or PDF of the document, base64-encoded (max 3 MB)."),
          mime_type: z
            .enum(["image/jpeg", "image/png", "application/pdf"])
            .optional()
            .describe("Required when file_base64 is sent."),
          hint: z.string().optional().describe("Optional hint, e.g. 'this is my car insurance'."),
        }),
      },
      async (input) => runTool(() => runAddDocument(input)),
    );

    server.registerTool(
      "list_deadlines",
      {
        title: "List deadlines",
        description:
          "List upcoming household deadlines (payments, renewals, reply-by dates, warranty ends, appointments) sorted by date, with amounts and days left. Defaults to today through the next 30 days.",
        inputSchema: z.object({
          from: isoDate.optional().describe("Start date (YYYY-MM-DD). Default: today."),
          to: isoDate.optional().describe("End date (YYYY-MM-DD). Default: 30 days after `from`."),
          kind: z.enum(DEADLINE_KINDS).optional().describe("Only return deadlines of this kind."),
        }),
        annotations: { readOnlyHint: true },
      },
      async (input) => runTool(() => runListDeadlines(input)),
    );

    server.registerTool(
      "explain_document",
      {
        title: "Explain document",
        description:
          "Explain a stored document in plain language: what it means, what happens if it's ignored, and the recommended next step. Find it by document_id or by keywords (query). Optionally answer a specific question.",
        inputSchema: z.object({
          document_id: z.string().optional().describe("Document id from search_documents or list_deadlines."),
          query: z.string().optional().describe("Keywords to find the document, e.g. 'parking notice'."),
          question: z.string().optional().describe("The user's question, e.g. 'What happens if I ignore it?'"),
        }),
        annotations: { readOnlyHint: true },
      },
      async (input) => runTool(() => runExplainDocument(input)),
    );

    server.registerTool(
      "check_warranty",
      {
        title: "Check warranty",
        description:
          "Check whether a product (e.g. 'dishwasher') is still under warranty: end date, days remaining and how to claim.",
        inputSchema: z.object({
          product: z.string().min(1).describe("Product name, e.g. 'dishwasher'."),
        }),
        annotations: { readOnlyHint: true },
      },
      async (input) => runTool(() => runCheckWarranty(input)),
    );

    server.registerTool(
      "draft_reply",
      {
        title: "Draft reply",
        description:
          "Draft a short letter or email replying to a stored document (e.g. ask for a payment extension, cancel a subscription, appeal a fine), using the document's real numbers and dates. Find it by document_id or by keywords (query).",
        inputSchema: z.object({
          document_id: z.string().optional().describe("Document id from search_documents or list_deadlines."),
          query: z.string().optional().describe("Keywords to find the document, e.g. 'electricity bill'."),
          intent: z.string().min(1).describe("What the reply should achieve, e.g. 'ask for a payment extension'."),
          tone: z.enum(["polite", "firm"]).optional().describe("Default: polite."),
        }),
        annotations: { readOnlyHint: true },
      },
      async (input) => runTool(() => runDraftReply(input)),
    );

    server.registerTool(
      "search_documents",
      {
        title: "Search documents",
        description:
          "Search the household's stored documents (bills, insurance, warranties, letters...) by keywords. Returns the top matches with id, title, issuer and type.",
        inputSchema: z.object({
          query: z.string().min(1).describe("Keywords, e.g. 'car insurance'."),
        }),
        annotations: { readOnlyHint: true },
      },
      async (input) => runTool(() => runSearchDocuments(input)),
    );
  },
  {
    serverInfo: { name: "papertrail", version: "0.2.0" },
  },
);

export { handler as GET, handler as POST };
