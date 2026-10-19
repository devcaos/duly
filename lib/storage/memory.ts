import type { FileMimeType } from "@/lib/llm";
import type { Document } from "@/lib/types";
import { todayISO } from "@/lib/dates";
import { liveDocuments, mergeWithSeed, pickDocument } from "./merge";
import type { StoredDocument } from "./merge";
import { fileKeyFor } from "./types";
import type { SaveOptions, StorageAdapter } from "./types";

// In-memory storage for local development. Data resets when the server restarts.
// Only saved documents live here; the sample documents are rebuilt on every read (see ./merge.ts).
export class MemoryStorage implements StorageAdapter {
  private docs = new Map<string, StoredDocument>();
  private files = new Map<string, Buffer>();

  private key(householdId: string, id: string) {
    return `${householdId}#${id}`;
  }

  async listDocuments(householdId: string): Promise<Document[]> {
    return mergeWithSeed(householdId, liveDocuments([...this.docs.values()], Date.now()), todayISO());
  }

  async getDocument(householdId: string, id: string): Promise<Document | undefined> {
    return pickDocument(householdId, id, todayISO(), async () => {
      const stored = this.docs.get(this.key(householdId, id));
      return stored ? liveDocuments([stored], Date.now())[0] : undefined;
    });
  }

  async saveDocument(doc: Document, options?: SaveOptions): Promise<void> {
    this.docs.set(this.key(doc.householdId, doc.id), { doc, expiresAt: options?.expiresAt });
  }

  async saveFile(householdId: string, docId: string, bytes: Buffer, mimeType: FileMimeType): Promise<string> {
    const fileKey = fileKeyFor(householdId, docId, mimeType);
    this.files.set(fileKey, bytes);
    return fileKey;
  }
}
