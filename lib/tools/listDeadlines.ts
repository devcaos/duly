import { z } from "zod";
import { getStorage, HOUSEHOLD_ID } from "@/lib/storage";
import { addDays, daysBetween, formatMoney, formatSpokenDate, todayISO } from "@/lib/dates";
import { deadlineKindSchema, deadlineSchema, isoDateSchema } from "@/lib/schemas";
import type { DeadlineKind, ToolResult } from "@/lib/types";

const SPOKEN_ITEMS = 3;

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

  const period = input.from || input.to ? `between ${from} and ${to}` : "in the next 30 days";
  let text: string;
  if (deadlines.length === 0) {
    text = `You have no ${input.payable ? "payments" : "deadlines"} ${period}.`;
  } else {
    const noun = input.payable ? "payment" : "deadline";
    const count = deadlines.length === 1 ? `one ${noun}` : `${deadlines.length} ${noun}s`;
    const items = deadlines.slice(0, SPOKEN_ITEMS).map(spokenItem);
    const rest = deadlines.length - items.length;
    if (rest > 0) items.push(`and ${rest} more`);
    text = `You have ${count} ${period}: ${items.join("; ")}.`;
  }

  return { text, structuredContent: { from, to, kind: input.kind, payable: input.payable, deadlines } };
}

// "October 22, Maplewood Elementary, return signed field-trip form and pay fee, $15.00"
function spokenItem(d: DeadlineItem): string {
  const description = d.description.charAt(0).toLowerCase() + d.description.slice(1);
  const amount = d.amount !== undefined ? `, ${formatMoney(d.amount, d.currency)}` : "";
  return `${formatSpokenDate(d.date)}, ${d.issuer}, ${description}${amount}`;
}
