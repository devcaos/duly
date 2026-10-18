import type { Document } from "@/lib/types";

// Helpers for households that keep several bills from the same issuer (this month's and
// earlier ones). The latest bill is the one that matters for search, explain and drafts.

// A bill with an amount: the only documents compare_bills can compare.
export function isBill(doc: Document): boolean {
  return doc.type === "bill" && doc.amount !== undefined;
}

// "Riverside Water Company" and "Riverside Water Co." are the same issuer.
const COMPANY_WORDS = new Set(["company", "co", "inc", "llc", "ltd", "corp", "corporation"]);

export function issuerKey(issuer: string): string {
  return issuer
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !COMPANY_WORDS.has(word))
    .join(" ");
}

// When the document was issued, else when it was saved ("YYYY-MM-DD..." compares as a string).
export function docDate(doc: Document): string {
  return doc.issueDate ?? doc.createdAt.slice(0, 10);
}

// Newest first; on the same date, the one saved last.
export function newestFirst(a: Document, b: Document): number {
  return docDate(b).localeCompare(docDate(a)) || b.createdAt.localeCompare(a.createdAt);
}

// Every issuer's bills, newest first, keyed by issuerKey.
export function billsByIssuer(docs: Document[]): Map<string, Document[]> {
  const groups = new Map<string, Document[]>();
  for (const doc of docs.filter(isBill)) {
    const key = issuerKey(doc.issuer);
    groups.set(key, [...(groups.get(key) ?? []), doc]);
  }
  for (const bills of groups.values()) bills.sort(newestFirst);
  return groups;
}

// Ids of bills that have a newer bill from the same issuer.
export function supersededBillIds(docs: Document[]): Set<string> {
  const ids = new Set<string>();
  for (const bills of billsByIssuer(docs).values()) {
    for (const bill of bills.slice(1)) ids.add(bill.id);
  }
  return ids;
}
