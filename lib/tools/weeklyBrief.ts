import { z } from "zod";
import { getStorage, HOUSEHOLD_ID } from "@/lib/storage";
import { addDays, daysBetween, describeDaysLeft, formatMoney, formatSpokenDate, todayISO } from "@/lib/dates";
import { isoDateSchema } from "@/lib/schemas";
import type { Deadline, Document, ToolResult } from "@/lib/types";
import { deadlineItems, deadlineItemSchema, spokenItem } from "./listDeadlines";
import { EXPIRING_SOON_DAYS, toWarranty, warrantyEnd, warrantySchema } from "./checkWarranty";
import type { Warranty } from "./checkWarranty";
import { buildComparisons, comparisonSchema, isNoticeablyHigher, verdictSentence } from "./compareBills";
import type { BillComparison } from "./compareBills";

// What needs attention in the next few days, most urgent first. No LLM: only stored data.

export const DEFAULT_BRIEF_DAYS = 7;
export const MAX_BRIEF_DAYS = 60;

const renewalSchema = z.object({
  documentId: z.string(),
  title: z.string(),
  issuer: z.string(),
  renewalDate: isoDateSchema,
  // Last day to cancel: the document's "cancel by" date, or the renewal date if it has none.
  cancelBy: isoDateSchema,
  daysToCancel: z.number().int(),
  amount: z.number().optional(),
  currency: z.string().optional(),
});

export const weeklyBriefOutput = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  days: z.number().int(),
  // Deadlines in the period, soonest first (without warranty ends and the renewals below).
  deadlines: z.array(deadlineItemSchema),
  // Renewals in the period that can still be cancelled, soonest cancel-by date first.
  renewals: z.array(renewalSchema),
  // Warranties that end within EXPIRING_SOON_DAYS (not yet expired), soonest first.
  warrantiesEndingSoon: z.array(warrantySchema),
  // Latest bills at least NOTICEABLY_HIGHER_PCT above usual that still have an open deadline.
  higherBills: z.array(comparisonSchema),
});

type Renewal = z.infer<typeof renewalSchema>;

const deadlineKey = (docId: string, d: Deadline) => `${docId}|${d.date}|${d.kind}|${d.description}`;

export async function runWeeklyBrief(input: { days?: number }): Promise<ToolResult<z.infer<typeof weeklyBriefOutput>>> {
  const days = input.days ?? DEFAULT_BRIEF_DAYS;
  const from = todayISO();
  const to = addDays(from, days);
  const docs = await getStorage().listDocuments(HOUSEHOLD_ID);
  const inPeriod = (date: string) => date >= from && date <= to;

  // A renewal and its cancel-by date are reported once, as a renewal.
  const covered = new Set<string>();
  const renewals: Renewal[] = [];
  for (const doc of docs) {
    for (const renewal of doc.deadlines.filter((d) => d.kind === "renewal" && inPeriod(d.date))) {
      const cancel = cancelDeadline(doc, renewal);
      const cancelBy = cancel?.date ?? renewal.date;
      if (cancelBy < from) continue; // too late to cancel: it stays an ordinary deadline
      covered.add(deadlineKey(doc.id, renewal));
      if (cancel) covered.add(deadlineKey(doc.id, cancel));
      renewals.push({
        documentId: doc.id,
        title: doc.title,
        issuer: doc.issuer,
        renewalDate: renewal.date,
        cancelBy,
        daysToCancel: daysBetween(from, cancelBy),
        amount: renewal.amount,
        currency: renewal.currency,
      });
    }
  }
  renewals.sort((a, b) => a.cancelBy.localeCompare(b.cancelBy));

  const deadlines = deadlineItems(docs, from)
    .filter((d) => inPeriod(d.date) && d.kind !== "warranty_ends")
    .filter((d) => !covered.has(deadlineKey(d.documentId, d)))
    .sort((a, b) => a.date.localeCompare(b.date));

  const warrantiesEndingSoon = docs
    .filter((doc) => warrantyEnd(doc))
    .map(toWarranty)
    .filter((w) => !w.expired && w.daysRemaining <= EXPIRING_SOON_DAYS)
    .sort((a, b) => a.endDate.localeCompare(b.endDate));

  // Only bills you can still act on: the latest bill has a deadline from today on.
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  const openDeadline = (c: BillComparison) =>
    byId.get(c.latest.documentId)?.deadlines.filter((d) => d.date >= from).sort((a, b) => a.date.localeCompare(b.date))[0];
  const higherBills = buildComparisons(docs).filter((c) => isNoticeablyHigher(c) && openDeadline(c));

  // One sentence per topic, the most urgent topic first (max 3 sentences).
  const sentences: { days: number; text: string }[] = [];
  const period = `In the next ${days === 1 ? "day" : `${days} days`}`;
  const due = [
    ...renewals.map((r) => ({ days: r.daysToCancel, text: spokenRenewal(r) })),
    ...deadlines.map((d) => ({ days: d.daysLeft, text: spokenItem(d) })),
  ].sort((a, b) => a.days - b.days);
  if (due.length > 0) {
    const more = due.length > 2 ? `, plus ${due.length - 2} more` : "";
    sentences.push({ days: due[0].days, text: `${period}: ${due.slice(0, 2).map((d) => d.text).join(", and ")}${more}.` });
  }
  if (warrantiesEndingSoon.length > 0) {
    sentences.push({ days: warrantiesEndingSoon[0].daysRemaining, text: spokenWarranties(warrantiesEndingSoon) });
  }
  if (higherBills.length > 0) {
    const first = higherBills[0];
    const text =
      higherBills.length === 1
        ? verdictSentence(first)
        : `${higherBills.length} bills are higher than usual; the biggest jump is ${first.issuer}, about ${Math.round(first.percentVsAverage ?? 0)}% above usual.`;
    sentences.push({ days: daysBetween(from, openDeadline(first)!.date), text });
  }
  sentences.sort((a, b) => a.days - b.days);
  if (due.length === 0 && sentences.length > 0) sentences.unshift({ days: -1, text: `Nothing is due ${period.toLowerCase()}.` });

  const text =
    sentences.length > 0
      ? sentences.map((s) => s.text).join(" ")
      : `Nothing needs your attention ${period.toLowerCase()}.`;
  return {
    text,
    structuredContent: { from, to, days, deadlines, renewals, warrantiesEndingSoon, higherBills },
  };
}

// The latest "cancel by" reply-by date of the same document, on or before the renewal.
function cancelDeadline(doc: Document, renewal: Deadline): Deadline | undefined {
  return doc.deadlines
    .filter((d) => d.kind === "reply_by" && /cancel/i.test(d.description) && d.date <= renewal.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
}

// "cancel PeakFit by October 22 if you don't want it to renew at $39.99"
function spokenRenewal(r: Renewal): string {
  const price = r.amount !== undefined ? ` at ${formatMoney(r.amount, r.currency)}` : "";
  return `cancel ${r.issuer} by ${formatSpokenDate(r.cancelBy)} if you don't want it to renew${price}`;
}

// "Your FrostLine fridge warranty ends on November 7, in 20 days."
function spokenWarranties(warranties: Warranty[]): string {
  const [first] = warranties;
  const name = first.product ? `${first.issuer} ${first.product}` : first.title;
  const more = warranties.length > 1 ? `, and ${warranties.length - 1} more end within ${EXPIRING_SOON_DAYS} days` : "";
  return `Your ${name} warranty ends on ${formatSpokenDate(first.endDate)}, ${describeDaysLeft(first.daysRemaining)}${more}.`;
}
