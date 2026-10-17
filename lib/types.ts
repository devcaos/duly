// Data model from SPEC.md section 5.

export type DocType =
  | "bill"
  | "insurance"
  | "warranty"
  | "official_letter"
  | "contract"
  | "subscription"
  | "school"
  | "other";

export type DeadlineKind =
  | "payment_due"
  | "renewal"
  | "reply_by"
  | "warranty_ends"
  | "appointment"
  | "other";

export const DOC_TYPES: DocType[] = [
  "bill",
  "insurance",
  "warranty",
  "official_letter",
  "contract",
  "subscription",
  "school",
  "other",
];

export const DEADLINE_KINDS: DeadlineKind[] = [
  "payment_due",
  "renewal",
  "reply_by",
  "warranty_ends",
  "appointment",
  "other",
];

export interface Deadline {
  date: string; // YYYY-MM-DD
  kind: DeadlineKind;
  description: string;
  amount?: number;
  currency?: string;
}

export interface Document {
  id: string;
  householdId: string;
  type: DocType;
  title: string;
  issuer: string;
  issueDate?: string;
  amount?: number;
  currency?: string;
  deadlines: Deadline[];
  summary: string;
  actionItems: string[];
  product?: string; // for warranties/receipts
  rawText: string;
  fileKey?: string;
  createdAt: string;
}

// Every tool returns a short spoken text plus the full data for screens.
export interface ToolResult<T> {
  text: string;
  structuredContent: T;
}
