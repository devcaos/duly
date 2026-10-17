import { getStorage, HOUSEHOLD_ID } from "@/lib/storage";
import { searchDocuments } from "@/lib/search";
import type { Document } from "@/lib/types";

// Error with a short message that is safe to speak back to the user.
export class ToolError extends Error {}

// Finds a document by id, else by the sender (issuer), else by the best search match for `query`.
export async function resolveDocument(input: { document_id?: string; query?: string; issuer?: string }): Promise<Document> {
  const storage = getStorage();

  if (input.document_id) {
    const doc = await storage.getDocument(HOUSEHOLD_ID, input.document_id);
    if (doc) return doc;
    if (!input.query && !input.issuer) throw new ToolError(`I couldn't find a document with id ${input.document_id}.`);
  }

  const docs = input.query || input.issuer ? await storage.listDocuments(HOUSEHOLD_ID) : [];

  if (input.issuer) {
    const issuer = input.issuer.trim().toLowerCase();
    const fromIssuer = docs.filter((doc) => doc.issuer.toLowerCase().includes(issuer));
    // Several documents from the same sender: let the keywords pick, else take the newest.
    const [byQuery] = input.query ? searchDocuments(fromIssuer, input.query, 1) : [];
    const newest = [...fromIssuer].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (byQuery ?? newest) return byQuery ?? newest;
  }

  if (input.query || input.issuer) {
    // An issuer that matched nothing exactly is still useful as search keywords.
    const [best] = searchDocuments(docs, [input.query, input.issuer].filter(Boolean).join(" "), 1);
    if (best) return best;
    throw new ToolError(`I couldn't find any document about "${input.query ?? input.issuer}".`);
  }

  throw new ToolError("Tell me which document you mean, by id or with a few keywords.");
}
