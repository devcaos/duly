import { z } from "zod";
import { getStorage, HOUSEHOLD_ID } from "@/lib/storage";
import { searchDocuments } from "@/lib/search";
import { documentRefSchema } from "@/lib/schemas";
import type { ToolResult } from "@/lib/types";

export const searchDocumentsOutput = z.object({
  query: z.string(),
  matches: z.array(documentRefSchema),
});

export async function runSearchDocuments(input: {
  query: string;
}): Promise<ToolResult<z.infer<typeof searchDocumentsOutput>>> {
  const docs = await getStorage().listDocuments(HOUSEHOLD_ID);
  const matches = searchDocuments(docs, input.query).map(({ id, title, issuer, type }) => ({
    id,
    title,
    issuer,
    type,
  }));

  let text: string;
  if (matches.length === 0) {
    text = `I couldn't find any document about "${input.query}".`;
  } else if (matches.length === 1) {
    text = `I found one document: ${matches[0].title}.`;
  } else {
    text = `I found ${matches.length} documents. The best match is ${matches[0].title}.`;
  }

  return { text, structuredContent: { query: input.query, matches } };
}
