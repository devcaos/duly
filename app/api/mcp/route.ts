import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { DEADLINE_KINDS } from "@/lib/types";
import type { ToolResult } from "@/lib/types";
import { runListDeadlines } from "@/lib/tools/listDeadlines";
import { runCheckWarranty } from "@/lib/tools/checkWarranty";
import { runSearchDocuments } from "@/lib/tools/searchDocuments";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD");

// Spoken text for voice + full data for screens (SPEC.md section 4).
function toMcpResult<T extends object>(result: ToolResult<T>) {
  return {
    content: [{ type: "text" as const, text: result.text }],
    structuredContent: result.structuredContent as Record<string, unknown>,
  };
}

const handler = createMcpHandler(
  (server) => {
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
      async (input) => toMcpResult(await runListDeadlines(input)),
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
      async (input) => toMcpResult(await runCheckWarranty(input)),
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
      async (input) => toMcpResult(await runSearchDocuments(input)),
    );
  },
  {
    serverInfo: { name: "papertrail", version: "0.1.0" },
  },
);

export { handler as GET, handler as POST };
