import { z } from "zod";
import { getLlm } from "@/lib/llm";
import type { FileMimeType } from "@/lib/llm";
import { getStorage, HOUSEHOLD_ID } from "@/lib/storage";
import { uploadExpiresAt } from "@/lib/storage/merge";
import { formatMoney, formatSpokenDate, todayISO } from "@/lib/dates";
import { decodeFile } from "@/lib/files";
import { documentSchema, isoDateSchema as isoDate } from "@/lib/schemas";
import { DEADLINE_KINDS, DOC_TYPES } from "@/lib/types";
import type { Document, ToolResult } from "@/lib/types";
import { ToolError } from "./resolveDocument";

// What the LLM must return. Validated with zod before anything is stored.
const extractionSchema = z.object({
  type: z.enum(DOC_TYPES),
  title: z.string().describe("Short title, e.g. 'Brightwave Energy electricity bill'"),
  issuer: z.string().describe("Company or organization that sent the document"),
  issueDate: isoDate.optional(),
  amount: z.number().optional().describe("Main amount (total due, premium, price)"),
  currency: z.string().optional().describe("ISO 4217 code, e.g. USD"),
  deadlines: z.array(
    z.object({
      date: isoDate,
      kind: z.enum(DEADLINE_KINDS),
      description: z.string().describe("Short action, e.g. 'Pay electricity bill'"),
      amount: z.number().optional(),
      currency: z.string().optional(),
    }),
  ),
  summary: z.string().describe("1-2 plain-language sentences"),
  actionItems: z.array(z.string()).describe("What the household should do, including how to pay or claim"),
  product: z.string().optional().describe("Product name for warranties/receipts, lowercase, e.g. 'dishwasher'"),
  rawText: z.string().describe("The important text of the document, transcribed"),
});

export const addDocumentOutput = z.object({ document: documentSchema });

const SYSTEM_PROMPT = `You extract structured data from household paperwork (bills, insurance, warranties, official letters, contracts, subscriptions, school forms).
Rules:
- Use only information that is in the document. Never invent amounts, dates or names. Leave optional fields out when unknown.
- All dates are YYYY-MM-DD. Resolve relative dates ("within 14 days") using today's date given in the prompt.
- Add one deadline for each date the household must act on: payments, renewals, reply-by dates, warranty end dates, appointments.
- For receipts with a warranty use type "warranty", set "product" and add a "warranty_ends" deadline.
- Write in English.`;

export async function runAddDocument(input: {
  text?: string;
  file_base64?: string;
  mime_type?: FileMimeType;
  hint?: string;
}): Promise<ToolResult<z.infer<typeof addDocumentOutput>>> {
  if (!input.text && !input.file_base64) {
    throw new ToolError("Please send the document as text or as a file.");
  }
  let fileBytes: Buffer | undefined;
  if (input.file_base64) {
    if (!input.mime_type) {
      throw new ToolError("Please say the file type: image/jpeg, image/png or application/pdf.");
    }
    // Strict base64 + size + magic bytes, before spending an LLM call.
    fileBytes = decodeFile(input.file_base64, input.mime_type);
  }

  const today = todayISO();
  const prompt = [
    `Today's date: ${today}.`,
    input.hint ? `Hint from the user: ${input.hint}` : "",
    input.text ? `Document text:\n${input.text}` : "The document is attached.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const extracted = await getLlm().generateJson({
    system: SYSTEM_PROMPT,
    prompt,
    file: input.file_base64 ? { base64: input.file_base64, mimeType: input.mime_type! } : undefined,
    schema: extractionSchema,
  });

  // The original file is stored only after a successful extraction, so failures leave no orphan files.
  const storage = getStorage();
  const id = `doc-${crypto.randomUUID().slice(0, 8)}`;
  const fileKey = fileBytes ? await storage.saveFile(HOUSEHOLD_ID, id, fileBytes, input.mime_type!) : undefined;

  const document: Document = {
    ...extracted,
    id,
    householdId: HOUSEHOLD_ID,
    rawText: input.text ?? extracted.rawText,
    fileKey,
    createdAt: new Date().toISOString(),
  };
  // Hidden after 24 hours: the public demo household is shared by everyone.
  await storage.saveDocument(document, { expiresAt: uploadExpiresAt(Date.now()) });

  return { text: `${savedSentence(document)} Duly noted.`, structuredContent: { document } };
}

// "Saved: Brightwave Energy bill, $84.20 due November 14." ("Duly noted." is added after it.)
function savedSentence(doc: Document): string {
  const kind = doc.type.replace("_", " ");
  const next = [...doc.deadlines].sort((a, b) => a.date.localeCompare(b.date)).find((d) => d.date >= todayISO());
  if (!next) return `Saved: ${doc.issuer} ${kind}. I didn't find any upcoming deadline.`;

  const amount = next.amount ?? doc.amount;
  const money = amount !== undefined ? `${formatMoney(amount, next.currency ?? doc.currency)} ` : "";
  const when = next.kind === "payment_due" ? "due" : `${next.kind.replace("_", " ")} on`;
  return `Saved: ${doc.issuer} ${kind}, ${money}${when} ${formatSpokenDate(next.date)}.`;
}
