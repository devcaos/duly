import type { FileMimeType } from "@/lib/llm";
import type { Document } from "@/lib/types";

// expiresAt: epoch seconds after which reads hide the document (uploads only). Kept in storage,
// never part of the Document returned by reads.
export interface SaveOptions {
  expiresAt?: number;
}

// Every storage backend (memory, aws) implements this interface,
// so the tools never need to know where documents live.
export interface StorageAdapter {
  listDocuments(householdId: string): Promise<Document[]>;
  getDocument(householdId: string, id: string): Promise<Document | undefined>;
  saveDocument(doc: Document, options?: SaveOptions): Promise<void>;
  // Stores the original uploaded file and returns its key (saved in Document.fileKey).
  saveFile(householdId: string, docId: string, bytes: Buffer, mimeType: FileMimeType): Promise<string>;
}

const EXTENSIONS: Record<FileMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

// "households/demo/doc-1a2b3c4d.pdf"
export function fileKeyFor(householdId: string, docId: string, mimeType: FileMimeType): string {
  return `households/${householdId}/${docId}.${EXTENSIONS[mimeType]}`;
}
