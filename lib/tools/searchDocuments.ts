import { getStorage, HOUSEHOLD_ID } from "@/lib/storage";
import { searchDocuments } from "@/lib/search";
import type { DocType, ToolResult } from "@/lib/types";

export interface SearchMatch {
  id: string;
  title: string;
  issuer: string;
  type: DocType;
}

export async function runSearchDocuments(input: {
  query: string;
}): Promise<ToolResult<{ query: string; matches: SearchMatch[] }>> {
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
