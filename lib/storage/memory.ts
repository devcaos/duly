import type { Document } from "@/lib/types";
import { todayISO } from "@/lib/dates";
import { buildSeedDocuments } from "./seed";
import type { StorageAdapter } from "./types";

// In-memory storage for local development. Data resets when the server restarts.
export class MemoryStorage implements StorageAdapter {
  private docs = new Map<string, Document>();
  private seeded = false;

  private ensureSeeded() {
    if (this.seeded) return;
    for (const doc of buildSeedDocuments(todayISO())) {
      this.docs.set(this.key(doc.householdId, doc.id), doc);
    }
    this.seeded = true;
  }

  private key(householdId: string, id: string) {
    return `${householdId}#${id}`;
  }

  async listDocuments(householdId: string): Promise<Document[]> {
    this.ensureSeeded();
    return [...this.docs.values()].filter((d) => d.householdId === householdId);
  }

  async getDocument(householdId: string, id: string): Promise<Document | undefined> {
    this.ensureSeeded();
    return this.docs.get(this.key(householdId, id));
  }

  async saveDocument(doc: Document): Promise<void> {
    this.ensureSeeded();
    this.docs.set(this.key(doc.householdId, doc.id), doc);
  }
}
