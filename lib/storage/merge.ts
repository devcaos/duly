import type { Document } from "@/lib/types";
import { buildSeedDocuments } from "./seed";

// The sample documents are never stored: every read rebuilds them from `today`, so their
// deadlines stay upcoming however long the server runs. Stored documents only add new ids;
// a stored copy of a seed id (left by an older seed script) is ignored, so the fresh seed always wins.

// Uploaded documents expire after 24 hours: everyone shares the demo household, so an upload
// should not stay visible to the next visitor for days. With DynamoDB TTL enabled on `expiresAt`,
// AWS also deletes the item some time after it expires; reads hide it right away.
export const UPLOAD_TTL_SECONDS = 24 * 60 * 60;

// A stored document plus its expiry (epoch seconds). The expiry never leaves the storage layer,
// so no tool output contains it. Documents without one never expire.
export interface StoredDocument {
  doc: Document;
  expiresAt?: number;
}

export function uploadExpiresAt(nowMs: number): number {
  return Math.floor(nowMs / 1000) + UPLOAD_TTL_SECONDS;
}

export function isExpired(stored: StoredDocument, nowMs: number): boolean {
  return stored.expiresAt !== undefined && stored.expiresAt * 1000 <= nowMs;
}

// The stored documents that have not expired yet.
export function liveDocuments(stored: StoredDocument[], nowMs: number): Document[] {
  return stored.filter((s) => !isExpired(s, nowMs)).map((s) => s.doc);
}

function seedFor(householdId: string, today: string): Document[] {
  return buildSeedDocuments(today).filter((doc) => doc.householdId === householdId);
}

// Seed documents first, then the stored documents whose id is not in the seed.
export function mergeWithSeed(householdId: string, stored: Document[], today: string): Document[] {
  const seed = seedFor(householdId, today);
  const seedIds = new Set(seed.map((doc) => doc.id));
  return [...seed, ...stored.filter((doc) => doc.householdId === householdId && !seedIds.has(doc.id))];
}

// The seed document with this id, else the stored one. `loadStored` is only called for
// ids that are not in the seed, so seed reads never touch the database.
export async function pickDocument(
  householdId: string,
  id: string,
  today: string,
  loadStored: () => Promise<Document | undefined>,
): Promise<Document | undefined> {
  return seedFor(householdId, today).find((doc) => doc.id === id) ?? (await loadStored());
}
