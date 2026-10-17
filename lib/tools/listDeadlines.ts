import { getStorage, HOUSEHOLD_ID } from "@/lib/storage";
import { addDays, daysBetween, describeDaysLeft, formatMoney, todayISO } from "@/lib/dates";
import type { DeadlineKind, ToolResult } from "@/lib/types";

export interface DeadlineItem {
  date: string;
  kind: DeadlineKind;
  description: string;
  amount?: number;
  currency?: string;
  daysLeft: number;
  documentId: string;
  documentTitle: string;
  issuer: string;
}

export async function runListDeadlines(input: {
  from?: string;
  to?: string;
  kind?: DeadlineKind;
}): Promise<ToolResult<{ from: string; to: string; kind?: DeadlineKind; deadlines: DeadlineItem[] }>> {
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
    .sort((a, b) => a.date.localeCompare(b.date));

  const period = input.from || input.to ? `between ${from} and ${to}` : "in the next 30 days";
  let text: string;
  if (deadlines.length === 0) {
    text = `You have no deadlines ${period}.`;
  } else {
    const first = deadlines[0];
    const amount = first.amount !== undefined ? `, ${formatMoney(first.amount, first.currency)}` : "";
    const count = deadlines.length === 1 ? "one deadline" : `${deadlines.length} deadlines`;
    text =
      `You have ${count} ${period}. ` +
      `The first is ${first.issuer}: ${first.description}${amount}, ${describeDaysLeft(first.daysLeft)}.`;
  }

  return { text, structuredContent: { from, to, kind: input.kind, deadlines } };
}
