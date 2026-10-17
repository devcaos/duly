import type { Document } from "@/lib/types";

// Very simple keyword search: good enough for a handful of household documents.

const STOP_WORDS = new Set(["a", "an", "the", "my", "of", "for", "is", "it", "to", "and", "do", "i"]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

// Fields that matter more get a higher weight.
function fieldsWithWeights(doc: Document): [string, number][] {
  return [
    [doc.title, 3],
    [doc.issuer, 3],
    [doc.product ?? "", 3],
    [doc.type.replace("_", " "), 2],
    [doc.summary, 1],
    [doc.rawText, 1],
  ];
}

export function scoreDocument(doc: Document, query: string): number {
  const words = tokenize(query);
  let score = 0;
  for (const [field, weight] of fieldsWithWeights(doc)) {
    const fieldWords = new Set(tokenize(field));
    for (const word of words) {
      // Prefix match so "renew" finds "renewal" and "dish" finds "dishwasher".
      if ([...fieldWords].some((w) => w.startsWith(word))) score += weight;
    }
  }
  return score;
}

export function searchDocuments(docs: Document[], query: string, limit = 5): Document[] {
  return docs
    .map((doc) => ({ doc, score: scoreDocument(doc, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.doc);
}
