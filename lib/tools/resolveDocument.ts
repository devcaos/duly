import { getStorage, HOUSEHOLD_ID } from "@/lib/storage";
import { searchDocuments } from "@/lib/search";
import type { Document } from "@/lib/types";

// Error with a short message that is safe to speak back to the user.
export class ToolError extends Error {}

// Finds a document by id, or else by the best search match for `query`.
export async function resolveDocument(input: { document_id?: string; query?: string }): Promise<Document> {
  const storage = getStorage();

  if (input.document_id) {
    const doc = await storage.getDocument(HOUSEHOLD_ID, input.document_id);
    if (doc) return doc;
    if (!input.query) throw new ToolError(`I couldn't find a document with id ${input.document_id}.`);
  }

  if (input.query) {
    const [best] = searchDocuments(await storage.listDocuments(HOUSEHOLD_ID), input.query, 1);
    if (best) return best;
    throw new ToolError(`I couldn't find any document about "${input.query}".`);
  }

  throw new ToolError("Tell me which document you mean, by id or with a few keywords.");
}
