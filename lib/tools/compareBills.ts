import { z } from "zod";
import { getStorage, HOUSEHOLD_ID } from "@/lib/storage";
import { billsByIssuer, docDate } from "@/lib/bills";
import { formatMoney, formatWholeMoney, perUnit } from "@/lib/dates";
import { scoreDocument, tokenize } from "@/lib/search";
import { isoDateSchema } from "@/lib/schemas";
import type { Document, ToolResult } from "@/lib/types";

// Compares an issuer's latest bill with its earlier ones, using only the stored amounts.
// It never guesses why a bill went up: the documents don't say, so neither does Duly.

// Within this many percent of the usual amount, a bill is "about the same as usual".
export const SAME_AS_USUAL_PCT = 5;
// weekly_brief mentions a bill when it is at least this many percent above the average of
// the issuer's earlier bills.
export const NOTICEABLY_HIGHER_PCT = 15;

export const BILL_TRENDS = ["higher", "lower", "about_the_same", "no_history"] as const;
export const CHANGE_TRENDS = ["higher", "lower", "about_the_same"] as const;

const billRefSchema = z.object({
  documentId: z.string(),
  title: z.string(),
  issueDate: isoDateSchema,
  amount: z.number(),
});

export const comparisonSchema = z.object({
  issuer: z.string(),
  currency: z.string(),
  latest: billRefSchema,
  // Earlier bills in the same currency, newest first.
  previous: z.array(billRefSchema),
  // The rest is absent when there is no earlier bill. Percentages have one decimal.
  previousAmount: z.number().optional(),
  differenceVsPrevious: z.number().optional(),
  percentVsPrevious: z.number().optional(),
  averageAmount: z.number().optional(),
  differenceVsAverage: z.number().optional(),
  percentVsAverage: z.number().optional(),
  trend: z.enum(BILL_TRENDS),
  // Usage and price per unit: only when the latest bill and at least one earlier bill state
  // their usage in the same unit. Averages use only those earlier bills.
  usageUnit: z.string().optional(),
  usageQuantity: z.number().optional(),
  usageBillsCompared: z.number().optional(),
  averageUsage: z.number().optional(),
  usagePercentVsAverage: z.number().optional(),
  usageTrend: z.enum(CHANGE_TRENDS).optional(),
  unitPrice: z.number().optional(),
  averageUnitPrice: z.number().optional(),
  unitPricePercentVsAverage: z.number().optional(),
  unitPriceTrend: z.enum(CHANGE_TRENDS).optional(),
});

export const compareBillsOutput = z.object({
  query: z.string().optional(),
  issuer: z.string().optional(),
  found: z.boolean(),
  // The issuer that matched `issuer` / `query`.
  comparison: comparisonSchema.optional(),
  // Every issuer with at least two bills, biggest change first (when no issuer was named).
  comparisons: z.array(comparisonSchema).optional(),
});

export type BillComparison = z.infer<typeof comparisonSchema>;

// Words that say what to do, not whose bill: "is my bill higher than usual?" names no issuer.
const GENERIC_WORDS = new Set(
  (
    "bill bills invoice invoices statement higher lower more less than usual normal compare compared comparison " +
    "previous last latest current this month months monthly average expensive cheaper up down any all are was " +
    "were what how much going gone has have been went why me our"
  ).split(" "),
);

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;
const percent = (amount: number, base: number) => ((amount - base) / base) * 100;
const average = (amounts: number[]) => amounts.reduce((sum, n) => sum + n, 0) / amounts.length;
const changeTrend = (pct: number) => (Math.abs(pct) < SAME_AS_USUAL_PCT ? "about_the_same" : pct > 0 ? "higher" : "lower");

function billRef(doc: Document) {
  return { documentId: doc.id, title: doc.title, issueDate: docDate(doc), amount: doc.amount ?? 0 };
}

// "kWh" and "KWH" are the same unit.
const unitKey = (unit: string) => unit.trim().toLowerCase();
const hasUsage = (doc: Document) => doc.usage !== undefined && doc.usage.quantity > 0 && unitKey(doc.usage.unit) !== "";
const unitPriceOf = (doc: Document) => (doc.amount ?? 0) / (doc.usage?.quantity ?? 1);

// The usage fields of a comparison, or none when the latest bill or every earlier bill has no
// usage in the latest bill's unit.
function compareUsage(latest: Document, earlier: Document[]): Partial<BillComparison> {
  if (!latest.usage || !hasUsage(latest)) return {};
  const unit = unitKey(latest.usage.unit);
  const withUsage = earlier.filter((bill) => hasUsage(bill) && unitKey(bill.usage!.unit) === unit);
  if (withUsage.length === 0) return {};

  const usualUsage = average(withUsage.map((bill) => bill.usage!.quantity));
  const usualUnitPrice = average(withUsage.map(unitPriceOf));
  const usagePct = percent(latest.usage.quantity, usualUsage);
  const unitPricePct = percent(unitPriceOf(latest), usualUnitPrice);
  return {
    usageUnit: latest.usage.unit,
    usageQuantity: latest.usage.quantity,
    usageBillsCompared: withUsage.length,
    averageUsage: round1(usualUsage),
    usagePercentVsAverage: round1(usagePct),
    usageTrend: changeTrend(usagePct),
    unitPrice: round4(unitPriceOf(latest)),
    averageUnitPrice: round4(usualUnitPrice),
    unitPricePercentVsAverage: round1(unitPricePct),
    unitPriceTrend: changeTrend(unitPricePct),
  };
}

// `bills`: one issuer's bills, newest first (see billsByIssuer).
export function compareIssuerBills(bills: Document[]): BillComparison {
  const [latest, ...earlier] = bills;
  const currency = latest.currency ?? "USD";
  const sameCurrency = earlier.filter((bill) => (bill.currency ?? "USD") === currency);
  const previous = sameCurrency.map(billRef);
  const base = { issuer: latest.issuer, currency, latest: billRef(latest), previous };
  if (previous.length === 0) return { ...base, trend: "no_history" };

  const amount = base.latest.amount;
  const previousAmount = previous[0].amount;
  const usual = average(previous.map((bill) => bill.amount));
  const vsUsual = percent(amount, usual);
  return {
    ...base,
    previousAmount,
    differenceVsPrevious: round2(amount - previousAmount),
    percentVsPrevious: round1(percent(amount, previousAmount)),
    averageAmount: round2(usual),
    differenceVsAverage: round2(amount - usual),
    percentVsAverage: round1(vsUsual),
    trend: changeTrend(vsUsual),
    ...compareUsage(latest, sameCurrency),
  };
}

// Every issuer's comparison: biggest increase vs usual first, issuers without history last.
export function buildComparisons(docs: Document[]): BillComparison[] {
  return [...billsByIssuer(docs).values()]
    .map(compareIssuerBills)
    .sort((a, b) => (b.percentVsAverage ?? -Infinity) - (a.percentVsAverage ?? -Infinity));
}

// At least NOTICEABLY_HIGHER_PCT above the average of the earlier bills (exact amounts, not
// the rounded percentage).
export function isNoticeablyHigher(comparison: BillComparison): boolean {
  if (comparison.previous.length === 0) return false;
  const usual = average(comparison.previous.map((bill) => bill.amount));
  return comparison.latest.amount >= usual * (1 + NOTICEABLY_HIGHER_PCT / 100);
}

// "Your Brightwave Energy bill is $84.20, about 22% higher than your usual $69."
export function verdictSentence(c: BillComparison): string {
  const amount = formatMoney(c.latest.amount, c.currency);
  if (c.trend === "no_history" || c.averageAmount === undefined || c.percentVsAverage === undefined) {
    return `I only have one ${c.issuer} bill on file, ${amount}, so there's nothing to compare it with yet.`;
  }
  // With a single earlier bill, "usual" would overstate it.
  const usual =
    c.previous.length === 1
      ? `your previous bill of ${formatMoney(c.averageAmount, c.currency)}`
      : `your usual ${formatWholeMoney(c.averageAmount, c.currency)}`;
  if (c.trend === "about_the_same") return `Your ${c.issuer} bill is ${amount}, about the same as ${usual}.`;
  const pct = Math.round(Math.abs(c.percentVsAverage));
  return `Your ${c.issuer} bill is ${amount}, about ${pct}% ${c.trend} than ${usual}.`;
}

// What was used, for "you used more electricity". Other units are said as they are.
const USED_BY_UNIT: Record<string, string> = { kwh: "electricity", gallon: "water", gallons: "water" };

// "You used about 22% more electricity than usual, at about the same price per kWh."
// "You used about the same amount of water as usual, but the price per gallon is about 15% higher."
// Only the stored numbers: never a reason, never advice. Empty without usage fields.
export function usageSentence(c: BillComparison): string {
  const { usageUnit: unit, usagePercentVsAverage: usagePct, unitPricePercentVsAverage: pricePct } = c;
  if (!unit || usagePct === undefined || pricePct === undefined || !c.usageTrend || !c.unitPriceTrend) return "";
  const what = USED_BY_UNIT[unitKey(unit)] ?? unit;
  const usual = c.usageBillsCompared === 1 ? "last time" : "usual";
  const used =
    c.usageTrend === "about_the_same"
      ? `You used about the same amount of ${what} as ${usual}`
      : `You used about ${Math.round(Math.abs(usagePct))}% ${c.usageTrend === "higher" ? "more" : "less"} ${what} than ${usual}`;
  const per = `price per ${perUnit(unit)}`;
  if (c.unitPriceTrend === "about_the_same") return `${used}, at about the same ${per}.`;
  const joiner = c.usageTrend === "about_the_same" ? "but" : "and";
  return `${used}, ${joiner} the ${per} is about ${Math.round(Math.abs(pricePct))}% ${c.unitPriceTrend}.`;
}

// "That's $14.10 more than your previous bill of $70.10."
function previousSentence(c: BillComparison): string {
  if (c.previous.length < 2 || c.previousAmount === undefined || c.differenceVsPrevious === undefined) return "";
  const diff = c.differenceVsPrevious;
  if (Math.abs(diff) < 0.005) return "That's the same as your previous bill.";
  const previous = formatMoney(c.previousAmount, c.currency);
  return `That's ${formatMoney(Math.abs(diff), c.currency)} ${diff > 0 ? "more" : "less"} than your previous bill of ${previous}.`;
}

export async function runCompareBills(input: {
  query?: string;
  issuer?: string;
}): Promise<ToolResult<z.infer<typeof compareBillsOutput>>> {
  const docs = await getStorage().listDocuments(HOUSEHOLD_ID);
  const groups = [...billsByIssuer(docs).values()];
  const asked = { query: input.query, issuer: input.issuer };
  if (groups.length === 0) {
    return { text: "I don't have any bills on file yet.", structuredContent: { ...asked, found: false } };
  }

  const words = tokenize(`${input.issuer ?? ""} ${input.query ?? ""}`).filter((word) => !GENERIC_WORDS.has(word));
  if (words.length === 0) return listAll(groups, asked);

  // The issuer whose bills match the words best.
  const keywords = words.join(" ");
  const best = groups
    .map((bills) => ({ bills, score: Math.max(...bills.map((bill) => scoreDocument(bill, keywords))) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)[0];
  if (!best) {
    const name = input.issuer?.trim() || keywords;
    return { text: `I couldn't find any bills from ${name}.`, structuredContent: { ...asked, found: false } };
  }

  const comparison = compareIssuerBills(best.bills);
  // At most 3 sentences: the verdict, usage and price per unit, the previous bill.
  const text = [verdictSentence(comparison), usageSentence(comparison), previousSentence(comparison)]
    .filter(Boolean)
    .join(" ");
  return { text, structuredContent: { ...asked, found: true, comparison } };
}

function listAll(
  groups: Document[][],
  asked: { query?: string; issuer?: string },
): ToolResult<z.infer<typeof compareBillsOutput>> {
  const comparisons = groups
    .map(compareIssuerBills)
    .filter((c) => c.trend !== "no_history")
    .sort((a, b) => Math.abs(b.percentVsAverage ?? 0) - Math.abs(a.percentVsAverage ?? 0));
  if (comparisons.length === 0) {
    return {
      text: "I only have one bill from each company so far, so there's nothing to compare yet.",
      structuredContent: { ...asked, found: false, comparisons },
    };
  }
  // The two biggest changes, without usage (that would be up to 4 sentences); the screen shows them all.
  const text = comparisons.slice(0, 2).map(verdictSentence).join(" ");
  return { text, structuredContent: { ...asked, found: true, comparisons } };
}
