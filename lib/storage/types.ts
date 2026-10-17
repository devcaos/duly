import type { Document } from "@/lib/types";

// Every storage backend (memory, aws) implements this interface,
// so the tools never need to know where documents live.
export interface StorageAdapter {
  listDocuments(householdId: string): Promise<Document[]>;
  getDocument(householdId: string, id: string): Promise<Document | undefined>;
  saveDocument(doc: Document): Promise<void>;
}
