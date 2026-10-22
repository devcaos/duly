import { z } from "zod";
import { getStorage, HOUSEHOLD_ID } from "@/lib/storage";
import {
  addDays,
  daysBetween,
  describeDaysLeft,
  endOfMonth,
  formatMoney,
  formatSpokenDate,
  todayISO,
} from "@/lib/dates";
import { itemWords, matchesItem } from "@/lib/match";
import { deadlineKindSchema, deadlineSchema, isoDateSchema } from "@/lib/schemas";
import type { DeadlineKind, Document, ToolResult } from "@/lib/types";

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
  // Only when one item was asked for ("car insurance").
  query: z.string().optional(),
  // false: the item has no deadline, and `deadlines` lists the upcoming ones of that kind instead.
  found: z.boolean().optional(),
  deadlines: z.array(deadlineItemSchema),
});

export type DeadlineItem = z.infer<typeof deadlineItemSchema>;

// Every deadline of every document, with its document and days left (not filtered or sorted).
export function deadlineItems(docs: Document[], today: string): DeadlineItem[] {
  return docs.flatMap((doc) =>
    doc.deadlines.map((deadline) => ({
      ...deadline,
      daysLeft: daysBetween(today, deadline.date),
      documentId: doc.id,
      documentTitle: doc.title,
      issuer: doc.issuer,
    })),
  );
}

// A question about one item ("when does the car insurance renew?") isn't limited to the next
// 30 days: a warranty that ends in two years is still the answer.
const ITEM_LOOKAHEAD_DAYS = 3650;

const KIND_NOUNS: Record<DeadlineKind, string> = {
  payment_due: "payment",
  renewal: "renewal",
  reply_by: "reply-by date",
  warranty_ends: "warranty end date",
  appointment: "appointment",
  other: "deadline",
};

type ListInput = {
  from?: string;
  to?: string;
  kind?: DeadlineKind;
  payable?: boolean;
  query?: string;
};

// The documents' deadlines in the period that pass the kind and payable filters, soonest first.
function selectDeadlines(
  docs: Document[],
  today: string,
  from: string,
  to: string,
  filters: { kind?: DeadlineKind; payable?: boolean },
): DeadlineItem[] {
  return (
    deadlineItems(docs, today)
      // ISO dates compare correctly as strings.
      .filter((d) => d.date >= from && d.date <= to)
      .filter((d) => !filters.kind || d.kind === filters.kind)
      // "What do I need to pay?" means every deadline with money attached: bills, renewals,
      // fees to send with a reply... not only kind "payment_due".
      .filter((d) => !filters.payable || d.amount !== undefined)
      .sort((a, b) => a.date.localeCompare(b.date))
  );
}

export async function runListDeadlines(input: ListInput): Promise<ToolResult<z.infer<typeof listDeadlinesOutput>>> {
  // A query that names no item ("my bills", "stuff") is no filter at all.
  const query = input.query?.trim();
  if (query && itemWords(query).length > 0) return listItemDeadlines(input, query);

  const today = todayISO();
  const from = input.from ?? today;
  const to = input.to ?? addDays(from, 30);

  const docs = await getStorage().listDocuments(HOUSEHOLD_ID);
  const deadlines = selectDeadlines(docs, today, from, to, input);

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

// The deadlines of one item. If nothing matches, it says so and lists the upcoming deadlines of
// that kind instead: it never answers about another item as if it were the one asked for.
async function listItemDeadlines(input: ListInput, query: string): Promise<ToolResult<z.infer<typeof listDeadlinesOutput>>> {
  const today = todayISO();
  const from = input.from ?? today;
  const explicit = Boolean(input.from || input.to);
  const docs = await getStorage().listDocuments(HOUSEHOLD_ID);
  const matched = docs.filter((doc) => matchesItem(doc, query));
  const asked = { kind: input.kind, payable: input.payable, query };
  const noun = input.kind ? KIND_NOUNS[input.kind] : input.payable ? "payment" : "deadline";

  const to = input.to ?? addDays(from, ITEM_LOOKAHEAD_DAYS);
  // "When is the car insurance due?" may come with kind payment_due although its deadline is a
  // renewal: the item's other deadlines are still about the item asked for.
  let deadlines = selectDeadlines(matched, today, from, to, input);
  if (deadlines.length === 0 && (input.kind || input.payable)) deadlines = selectDeadlines(matched, today, from, to, {});

  if (deadlines.length > 0) {
    const [first] = deadlines;
    const text =
      deadlines.length === 1
        ? `${spokenItemDate(first)}, ${describeDaysLeft(first.daysLeft)}${first.amount !== undefined ? `, for ${formatMoney(first.amount, first.currency)}` : ""}.`
        : `I found ${deadlines.length} deadlines for ${query}. The next one is ${spokenItemDate(first)}, ${describeDaysLeft(first.daysLeft)}.`;
    return { text, structuredContent: { from, to, ...asked, found: true, deadlines } };
  }

  // Not found: the upcoming deadlines of that kind, in the period asked for (default 30 days).
  const listTo = input.to ?? addDays(from, 30);
  const upcoming = selectDeadlines(docs, today, from, listTo, input);
  const period = describePeriod(today, from, listTo, explicit);
  const missing =
    matched.length > 0
      ? `I found your ${query}, but it has no ${explicit ? `${noun} ${period}` : `upcoming ${noun}`}.`
      : `I couldn't find ${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun} for ${query}.`;
  const shown = upcoming.slice(0, 3).map((d) => `${d.issuer} on ${formatSpokenDate(d.date)}`);
  const more = upcoming.length > shown.length ? `, plus ${upcoming.length - shown.length} more` : "";
  const list =
    upcoming.length === 0
      ? `You have no ${noun}s ${period}.`
      : `Upcoming ${noun}s: ${shown.length > 1 ? `${shown.slice(0, -1).join(", ")}, and ${shown.at(-1)}` : shown[0]}${more}.`;
  return {
    text: `${missing} ${list}`,
    structuredContent: { from, to: listTo, ...asked, found: false, deadlines: upcoming },
  };
}

// "Northpoint Mutual: car insurance policy renews automatically on November 12"
function spokenItemDate(d: DeadlineItem): string {
  const description = d.description.charAt(0).toLowerCase() + d.description.slice(1);
  return `${d.issuer}: ${description} on ${formatSpokenDate(d.date)}`;
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
export function spokenItem(d: DeadlineItem): string {
  if (d.amount !== undefined) {
    return `${formatMoney(d.amount, d.currency)} to ${d.issuer}, due ${formatSpokenDate(d.date)}`;
  }
  const description = d.description.charAt(0).toLowerCase() + d.description.slice(1);
  return `${d.issuer}: ${description}, on ${formatSpokenDate(d.date)}`;
}
