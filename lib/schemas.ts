import { z } from "zod";
import { isValidISODate } from "@/lib/dates";
import { MAX_FILE_BYTES } from "@/lib/files";
import { DEADLINE_KINDS, DOC_TYPES } from "@/lib/types";
import type { Document } from "@/lib/types";

// Shared zod pieces for tool inputs, tool outputs and LLM output.

export const MAX_TEXT_CHARS = 20_000;
export const MAX_SHORT_CHARS = 500; // hint, intent, question, query
export const MAX_PRODUCT_CHARS = 200;
export const MAX_ID_CHARS = 100;
// Base64 uses 4 characters for every 3 bytes.
export const MAX_BASE64_CHARS = Math.ceil(MAX_FILE_BYTES / 3) * 4;

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .refine(isValidISODate, "Not a real calendar date");

export const shortText = () => z.string().max(MAX_SHORT_CHARS);

export const docTypeSchema = z.enum(DOC_TYPES);
export const deadlineKindSchema = z.enum(DEADLINE_KINDS);

export const deadlineSchema = z.object({
  date: isoDateSchema,
  kind: deadlineKindSchema,
  description: z.string(),
  amount: z.number().optional(),
  currency: z.string().optional(),
});

// Same shape as the Document type in lib/types.ts (checked below).
export const documentSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  type: docTypeSchema,
  title: z.string(),
  issuer: z.string(),
  issueDate: isoDateSchema.optional(),
  amount: z.number().optional(),
  currency: z.string().optional(),
  deadlines: z.array(deadlineSchema),
  summary: z.string(),
  actionItems: z.array(z.string()),
  product: z.string().optional(),
  rawText: z.string(),
  fileKey: z.string().optional(),
  createdAt: z.string(),
});

// Short reference to a document, used in tool outputs.
export const documentRefSchema = documentSchema.pick({ id: true, title: true, issuer: true, type: true });

// Build fails if documentSchema and the Document type ever drift apart.
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
export type DocumentSchemaMatchesType = Assert<Equals<z.infer<typeof documentSchema>, Document>>;
