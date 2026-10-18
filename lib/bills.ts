import type { Document } from "@/lib/types";

// Helpers for households that keep several bills from the same issuer (this month's and
// earlier ones). The latest bill is the one that matters for search, explain and drafts.

// Any bill, with or without an amount: decides which bill is the latest of an issuer.
export function isBillDoc(doc: Document): boolean {
  return doc.type === "bill";
}

// A bill with an amount: the only documents compare_bills can compare.
export function isBill(doc: Document): boolean {
  return isBillDoc(doc) && doc.amount !== undefined;
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

function groupByIssuer(docs: Document[], include: (doc: Document) => boolean): Map<string, Document[]> {
  const groups = new Map<string, Document[]>();
  for (const doc of docs.filter(include)) {
    const key = issuerKey(doc.issuer);
    groups.set(key, [...(groups.get(key) ?? []), doc]);
  }
  for (const bills of groups.values()) bills.sort(newestFirst);
  return groups;
}

// Every issuer's bills with an amount, newest first, keyed by issuerKey (to compare amounts).
export function billsByIssuer(docs: Document[]): Map<string, Document[]> {
  return groupByIssuer(docs, isBill);
}

// Every issuer's bills, amount or not, newest first (to find the latest one).
export function allBillsByIssuer(docs: Document[]): Map<string, Document[]> {
  return groupByIssuer(docs, isBillDoc);
}

// Ids of bills that have a newer bill from the same issuer, even one without an amount.
export function supersededBillIds(docs: Document[]): Set<string> {
  const ids = new Set<string>();
  for (const bills of allBillsByIssuer(docs).values()) {
    for (const bill of bills.slice(1)) ids.add(bill.id);
  }
  return ids;
}
