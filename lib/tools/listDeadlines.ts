import { z } from "zod";
import { getStorage, HOUSEHOLD_ID } from "@/lib/storage";
import { addDays, daysBetween, endOfMonth, formatMoney, formatSpokenDate, todayISO } from "@/lib/dates";
import { deadlineKindSchema, deadlineSchema, isoDateSchema } from "@/lib/schemas";
import type { DeadlineKind, ToolResult } from "@/lib/types";

export const deadlineItemSchema = deadlineSchema.extend({
  daysLeft: z.number().int(),
  documentId: z.string(),
  documentTitle: z.string(),
  issuer: z.string(),
});

export const listDeadlinesOutput = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  kind: deadlineKindSchema.optional(),
  payable: z.boolean().optional(),
  deadlines: z.array(deadlineItemSchema),
});

type DeadlineItem = z.infer<typeof deadlineItemSchema>;

export async function runListDeadlines(input: {
  from?: string;
  to?: string;
  kind?: DeadlineKind;
  payable?: boolean;
}): Promise<ToolResult<z.infer<typeof listDeadlinesOutput>>> {
  const today = todayISO();
  const from = input.from ?? today;
  const to = input.to ?? addDays(from, 30);

  const docs = await getStorage().listDocuments(HOUSEHOLD_ID);
  const deadlines: DeadlineItem[] = docs
    .flatMap((doc) =>
      doc.deadlines.map((deadline) => ({
        ...deadline,
        daysLeft: daysBetween(today, deadline.date),
        documentId: doc.id,
        documentTitle: doc.title,
        issuer: doc.issuer,
      })),
    )
    // ISO dates compare correctly as strings.
    .filter((d) => d.date >= from && d.date <= to)
    .filter((d) => !input.kind || d.kind === input.kind)
    // "What do I need to pay?" means every deadline with money attached: bills, renewals,
    // fees to send with a reply... not only kind "payment_due".
    .filter((d) => !input.payable || d.amount !== undefined)
    .sort((a, b) => a.date.localeCompare(b.date));

  const noun = input.payable ? "payment" : "deadline";
  const period = describePeriod(today, from, to, Boolean(input.from || input.to));
  let text: string;
  if (deadlines.length === 0) {
    text = `You have no ${noun}s ${period}.`;
  } else if (deadlines.length === 1) {
    text = `You have one ${noun} ${period}: ${spokenItem(deadlines[0])}.`;
  } else {
    // Voice stays short: the count, the total (payments) and the next item. Cards show them all.
    text = `You have ${deadlines.length} ${noun}s ${period}${input.payable ? spokenTotal(deadlines) : ""}. ` +
      `The next one is ${spokenItem(deadlines[0])}.`;
  }

  return { text, structuredContent: { from, to, kind: input.kind, payable: input.payable, deadlines } };
}

// The period actually used, in words: "in the next 30 days" (default), "this month",
// "until November 5" or "between October 1 and October 31".
function describePeriod(today: string, from: string, to: string, explicit: boolean): string {
  if (!explicit) return "in the next 30 days";
  if (from === today && to === endOfMonth(today)) return "this month";
  if (from === today) return `until ${formatSpokenDate(to)}`;
  return `between ${formatSpokenDate(from)} and ${formatSpokenDate(to)}`;
}

// ", $184.19 in total" (only when every amount uses the same currency).
function spokenTotal(deadlines: DeadlineItem[]): string {
  const currencies = new Set(deadlines.map((d) => d.currency ?? "USD"));
  if (currencies.size !== 1) return "";
  const total = deadlines.reduce((sum, d) => sum + (d.amount ?? 0), 0);
  return `, ${formatMoney(total, [...currencies][0])} in total`;
}

// "$15.00 to Maplewood Elementary, due October 22" or
// "PeakFit: last day to cancel before the gym membership renews, on October 21"
function spokenItem(d: DeadlineItem): string {
  if (d.amount !== undefined) {
    return `${formatMoney(d.amount, d.currency)} to ${d.issuer}, due ${formatSpokenDate(d.date)}`;
  }
  const description = d.description.charAt(0).toLowerCase() + d.description.slice(1);
  return `${d.issuer}: ${description}, on ${formatSpokenDate(d.date)}`;
}
