import { getStorage, HOUSEHOLD_ID } from "@/lib/storage";
import { supersededBillIds } from "@/lib/bills";
import { conflictingTypeWords } from "@/lib/match";
import { searchDocuments, tokenize } from "@/lib/search";
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

  const text = [input.query, input.issuer].filter(Boolean).join(" ");
  const stored = text ? await storage.listDocuments(HOUSEHOLD_ID) : [];
  // A document about another kind of item is never the answer: "explain my home insurance
  // letter" must not explain the car insurance just because both say "insurance".
  const docs = stored.filter((doc) => conflictingTypeWords(doc, text).length === 0);
  if (stored.length > 0 && docs.length === 0) {
    throw new ToolError(`I couldn't find any document about ${conflictPhrase(stored, text)}.`);
  }

  if (input.issuer) {
    const issuer = input.issuer.trim().toLowerCase();
    const fromIssuer = docs.filter((doc) => doc.issuer.toLowerCase().includes(issuer));
    // Several documents from the same sender: let the keywords pick, else take the newest.
    // Earlier bills only count when nothing else from that sender is left.
    const [byQuery] = input.query ? searchDocuments(fromIssuer, input.query, 1) : [];
    const superseded = supersededBillIds(docs);
    const current = fromIssuer.filter((doc) => !superseded.has(doc.id));
    const newest = [...(current.length > 0 ? current : fromIssuer)].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )[0];
    if (byQuery ?? newest) return byQuery ?? newest;
  }

  if (text) {
    // An issuer that matched nothing exactly is still useful as search keywords.
    const [best] = searchDocuments(docs, text, 1);
    if (best) return best;
    throw new ToolError(`I couldn't find any document about "${input.query ?? input.issuer}".`);
  }

  throw new ToolError("Tell me which document you mean, by id or with a few keywords.");
}

// "home insurance": the first kind of item (word + noun) that no document has.
function conflictPhrase(docs: Document[], text: string): string {
  const words = tokenize(text);
  const pairs = words.slice(0, -1).map((word, i) => `${word} ${words[i + 1]}`);
  return pairs.find((pair) => docs.every((doc) => conflictingTypeWords(doc, pair).length > 0)) ?? `"${text}"`;
}
