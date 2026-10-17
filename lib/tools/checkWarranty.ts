import { getStorage, HOUSEHOLD_ID } from "@/lib/storage";
import { daysBetween, formatSpokenDate, todayISO } from "@/lib/dates";
import { scoreDocument } from "@/lib/search";
import type { ToolResult } from "@/lib/types";

export interface WarrantyInfo {
  documentId: string;
  title: string;
  issuer: string;
  product?: string;
  endDate: string;
  daysRemaining: number;
  expired: boolean;
  howToClaim: string[];
}

export async function runCheckWarranty(input: {
  product: string;
}): Promise<ToolResult<{ product: string; found: boolean; warranty?: WarrantyInfo }>> {
  const docs = await getStorage().listDocuments(HOUSEHOLD_ID);

  // A document counts as a warranty if it has a warranty end date.
  const best = docs
    .map((doc) => ({
      doc,
      ends: doc.deadlines.find((d) => d.kind === "warranty_ends"),
      score: scoreDocument(doc, input.product),
    }))
    .filter((r) => r.ends && r.score > 0)
    .sort((a, b) => b.score - a.score)[0];

  if (!best || !best.ends) {
    return {
      text: `I couldn't find a warranty for ${input.product}.`,
      structuredContent: { product: input.product, found: false },
    };
  }

  const { doc, ends } = best;
  const daysRemaining = daysBetween(todayISO(), ends.date);
  const expired = daysRemaining < 0;
  const name = doc.product ?? input.product;
  const text = expired
    ? `Your ${name} warranty from ${doc.issuer} expired on ${formatSpokenDate(ends.date)}.`
    : `Yes, your ${name} is under warranty until ${formatSpokenDate(ends.date)}, ${daysRemaining} days from now. ` +
      `${doc.actionItems[0] ?? ""}`.trim();

  return {
    text,
    structuredContent: {
      product: input.product,
      found: true,
      warranty: {
        documentId: doc.id,
        title: doc.title,
        issuer: doc.issuer,
        product: doc.product,
        endDate: ends.date,
        daysRemaining,
        expired,
        howToClaim: doc.actionItems,
      },
    },
  };
}
