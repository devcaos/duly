import { z } from "zod";
import { getStorage, HOUSEHOLD_ID } from "@/lib/storage";
import { daysBetween, formatSpokenDate, todayISO } from "@/lib/dates";
import { scoreDocument } from "@/lib/search";
import { isoDateSchema } from "@/lib/schemas";
import type { Document, ToolResult } from "@/lib/types";

// A warranty ending in this many days or fewer counts as "expiring soon".
const EXPIRING_SOON_DAYS = 60;

export const WARRANTY_STATUSES = ["active", "expiring_soon", "expired"] as const;
type WarrantyStatus = (typeof WARRANTY_STATUSES)[number];

const warrantySchema = z.object({
  documentId: z.string(),
  title: z.string(),
  issuer: z.string(),
  product: z.string().optional(),
  // Purchase/issue date, when known: lets screens draw how much of the warranty is used.
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema,
  daysRemaining: z.number().int(),
  expired: z.boolean(),
  status: z.enum(WARRANTY_STATUSES),
  howToClaim: z.array(z.string()),
});

export const checkWarrantyOutput = z.object({
  // Absent when the caller asked for all warranties.
  product: z.string().optional(),
  found: z.boolean(),
  // The best match for `product`.
  warranty: warrantySchema.optional(),
  // Every warranty on file, soonest end date first (only when no specific product was asked).
  warranties: z.array(warrantySchema).optional(),
});

type Warranty = z.infer<typeof warrantySchema>;

// "all", "my warranties", "everything"... mean "list them all", not a product name.
const GENERIC_PRODUCT =
  /^(?:(?:all|any|every|each|my|of|the|still|active|current|valid)\s+)*(?:warrant(?:y|ies)|items?|products?|appliances?|things?|everything|all|any)?$/i;

export async function runCheckWarranty(input: {
  product?: string;
}): Promise<ToolResult<z.infer<typeof checkWarrantyOutput>>> {
  const docs = await getStorage().listDocuments(HOUSEHOLD_ID);
  // A document counts as a warranty if it has a warranty end date.
  const warranties = docs.filter((doc) => warrantyEnd(doc));

  const product = input.product?.trim() ?? "";
  if (GENERIC_PRODUCT.test(product)) return listAll(warranties);

  const best = warranties
    .map((doc) => ({ doc, score: scoreDocument(doc, product) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)[0];

  if (!best) {
    return {
      text: `I couldn't find a warranty for ${product}.`,
      structuredContent: { product, found: false },
    };
  }

  const warranty = toWarranty(best.doc);
  const name = best.doc.product ?? product;
  const text = warranty.expired
    ? `Your ${name} warranty from ${warranty.issuer} expired on ${formatSpokenDate(warranty.endDate)}.`
    : `Yes, your ${name} is under warranty until ${formatSpokenDate(warranty.endDate)}, ${warranty.daysRemaining} days from now. ` +
      `${warranty.howToClaim[0] ?? ""}`.trim();

  return { text, structuredContent: { product, found: true, warranty } };
}

function listAll(docs: Document[]): ToolResult<z.infer<typeof checkWarrantyOutput>> {
  const warranties = docs.map(toWarranty).sort((a, b) => a.endDate.localeCompare(b.endDate));
  if (warranties.length === 0) {
    return { text: "I don't have any warranties on file.", structuredContent: { found: false, warranties } };
  }

  const count = (status: WarrantyStatus) => warranties.filter((w) => w.status === status).length;
  const parts = [
    [count("active"), "active"],
    [count("expiring_soon"), "expiring soon"],
    [count("expired"), "expired"],
  ]
    .filter(([n]) => Number(n) > 0)
    .map(([n, label]) => `${n} ${label}`);

  // The next one to end is the one worth hearing about.
  const next = warranties.find((w) => !w.expired);
  const nextSentence = next
    ? ` Your ${next.product ?? next.title} is covered until ${formatSpokenDate(next.endDate)}.`
    : "";
  const text =
    warranties.length === 1
      ? `You have one warranty on file, and it's ${parts[0].replace(/^1 /, "")}.${nextSentence}`
      : `You have ${warranties.length} warranties on file: ${parts.join(", ")}.${nextSentence}`;

  return { text, structuredContent: { found: true, warranties } };
}

function warrantyEnd(doc: Document) {
  return doc.deadlines.find((d) => d.kind === "warranty_ends");
}

function toWarranty(doc: Document): Warranty {
  const endDate = warrantyEnd(doc)!.date;
  const daysRemaining = daysBetween(todayISO(), endDate);
  const status: WarrantyStatus =
    daysRemaining < 0 ? "expired" : daysRemaining <= EXPIRING_SOON_DAYS ? "expiring_soon" : "active";
  return {
    documentId: doc.id,
    title: doc.title,
    issuer: doc.issuer,
    product: doc.product,
    startDate: doc.issueDate,
    endDate,
    daysRemaining,
    expired: daysRemaining < 0,
    status,
    howToClaim: doc.actionItems,
  };
}
