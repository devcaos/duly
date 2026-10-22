import { z } from "zod";
import { getStorage, HOUSEHOLD_ID } from "@/lib/storage";
import { daysBetween, describeDaysLeft, formatSpokenDate, todayISO } from "@/lib/dates";
import { itemWords, matchesItem } from "@/lib/match";
import { scoreDocument } from "@/lib/search";
import { isoDateSchema } from "@/lib/schemas";
import type { Document, ToolResult } from "@/lib/types";

// A warranty ending in this many days or fewer counts as "expiring soon".
export const EXPIRING_SOON_DAYS = 60;

export const WARRANTY_STATUSES = ["active", "expiring_soon", "expired"] as const;
type WarrantyStatus = (typeof WARRANTY_STATUSES)[number];

export const warrantySchema = z.object({
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

export type Warranty = z.infer<typeof warrantySchema>;

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
  if (GENERIC_PRODUCT.test(product) || itemWords(product).length === 0) return listAll(warranties);

  // Every word that names the product must match ("coffee machine" is not the washing machine);
  // among the matches, the best search score wins.
  const best = warranties
    .filter((doc) => matchesItem(doc, product))
    .map((doc) => ({ doc, score: scoreDocument(doc, product) }))
    .sort((a, b) => b.score - a.score)[0];

  if (!best) {
    return {
      text: `I couldn't find a warranty for ${product}.`,
      structuredContent: { product, found: false },
    };
  }

  const warranty = toWarranty(best.doc);
  const name = best.doc.product ?? product;
  const end = formatSpokenDate(warranty.endDate);
  const claim = warranty.howToClaim[0] ?? "";
  // The status is always said out loud: "expired" and "expiring soon" are what people need to hear.
  const text =
    warranty.status === "expired"
      ? `Your ${name} warranty from ${warranty.issuer} expired on ${end}, ${describeDaysLeft(warranty.daysRemaining)}.`
      : warranty.status === "expiring_soon"
        ? `Your ${name} is still under warranty, but it's expiring soon: it ends on ${end}, ${describeDaysLeft(warranty.daysRemaining)}. ${claim}`.trim()
        : `Yes, your ${name} is under warranty until ${end}, ${warranty.daysRemaining} days from now. ${claim}`.trim();

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

  // Worth hearing about: the next one to expire soon and the one that expired last.
  // With neither, the next one to end.
  const name = (w: Warranty) => w.product ?? w.title;
  const expiringSoon = warranties.find((w) => w.status === "expiring_soon");
  const lastExpired = warranties.findLast((w) => w.status === "expired");
  const next = warranties.find((w) => !w.expired);
  const details = [
    expiringSoon && `Your ${name(expiringSoon)} warranty is expiring soon, on ${formatSpokenDate(expiringSoon.endDate)}.`,
    lastExpired && `Your ${name(lastExpired)} warranty expired on ${formatSpokenDate(lastExpired.endDate)}.`,
  ].filter(Boolean);
  if (details.length === 0 && next) details.push(`Your ${name(next)} is covered until ${formatSpokenDate(next.endDate)}.`);
  const counts =
    warranties.length === 1
      ? `You have one warranty on file, and it's ${parts[0].replace(/^1 /, "")}.`
      : `You have ${warranties.length} warranties on file: ${parts.join(", ")}.`;
  const text = [counts, ...details].join(" ");

  return { text, structuredContent: { found: true, warranties } };
}

export function warrantyEnd(doc: Document) {
  return doc.deadlines.find((d) => d.kind === "warranty_ends");
}

export function toWarranty(doc: Document): Warranty {
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
