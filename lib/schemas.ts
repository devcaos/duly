import { z } from "zod";
import { isValidISODate } from "@/lib/dates";
import { MAX_FILE_BYTES } from "@/lib/files";

// Shared zod pieces for tool inputs and LLM output.

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
