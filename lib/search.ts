import { allBillsByIssuer, docDate, isBillDoc, issuerKey, supersededBillIds } from "@/lib/bills";
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

const MONTHS = new Set(
  "january february march april may june july august september october november december".split(" "),
);

// The query names a month that is in this bill's title but not in the latest bill's:
// "my September Brightwave bill".
function namesOwnMonth(doc: Document, latest: Document | undefined, query: string): boolean {
  const own = new Set(tokenize(doc.title));
  const latestWords = new Set(tokenize(latest?.title ?? ""));
  // "may" only counts written as a month ("May"), not in "what may happen".
  const named = tokenize(query).filter((word) => word !== "may" || /\bMay\b/.test(query));
  return named.some((word) => MONTHS.has(word) && own.has(word) && !latestWords.has(word));
}

// An earlier bill never ranks above the latest bill of the same issuer: "my Brightwave bill"
// means this month's. If the latest bill doesn't match at all, or the query names the earlier
// bill's month, the earlier one keeps its score, so it can still be found on purpose.
export function searchDocuments(docs: Document[], query: string, limit = 5): Document[] {
  const scores = new Map(docs.map((doc) => [doc.id, scoreDocument(doc, query)]));
  const latest = new Map([...allBillsByIssuer(docs)].map(([key, bills]) => [key, bills[0]]));
  const superseded = supersededBillIds(docs);

  return docs
    .map((doc) => {
      let score = scores.get(doc.id) ?? 0;
      if (superseded.has(doc.id) && isBillDoc(doc)) {
        const latestBill = latest.get(issuerKey(doc.issuer));
        const latestScore = scores.get(latestBill?.id ?? "") ?? 0;
        if (latestScore > 0 && !namesOwnMonth(doc, latestBill, query)) score = Math.min(score, latestScore);
      }
      return { doc, score, superseded: superseded.has(doc.id) };
    })
    .filter((r) => r.score > 0)
    // Higher score first; on a tie, current documents before earlier bills, newest earlier bill first.
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(a.superseded) - Number(b.superseded) ||
        (a.superseded ? docDate(b.doc).localeCompare(docDate(a.doc)) : 0),
    )
    .slice(0, limit)
    .map((r) => r.doc);
}
