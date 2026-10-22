"use client";

import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { daysBetween, formatMoney, formatSpokenDate, formatUnitPrice, perUnit } from "@/lib/dates";
import { capitalizeFirst } from "@/lib/speech";
import { useCountUp } from "./hooks";
import styles from "./echo.module.css";

// Result cards of the Echo Show simulator. `data` is a Duly tool's structuredContent.

export interface DeadlineItem {
  date: string;
  kind: string;
  description: string;
  amount?: number;
  currency?: string;
  daysLeft: number;
  documentTitle: string;
  issuer: string;
}

interface DocumentData {
  type: string;
  title: string;
  issuer: string;
  issueDate?: string;
  amount?: number;
  currency?: string;
  deadlines: { date: string; kind: string; description: string; amount?: number; currency?: string }[];
  summary: string;
  actionItems: string[];
  product?: string;
}

interface WarrantyInfo {
  documentId: string;
  title: string;
  issuer: string;
  product?: string;
  startDate?: string;
  endDate: string;
  daysRemaining: number;
  expired: boolean;
  status: "active" | "expiring_soon" | "expired";
  howToClaim: string[];
}

interface WarrantyData {
  product?: string;
  found: boolean;
  warranty?: WarrantyInfo;
  // Present when the user asked about all warranties.
  warranties?: WarrantyInfo[];
}

export interface DraftData {
  document: { id: string; title: string; issuer: string };
  intent: string;
  tone: "polite" | "firm";
  subject: string;
  body: string;
}

interface ExplanationData {
  document: { title: string; issuer: string };
  explanation: string;
  consequencesOfInaction: string;
  recommendedNextStep: string;
  disclaimer?: string;
}

interface MatchesData {
  matches: { id: string; title: string; issuer: string; type: string }[];
}

interface BillRef {
  documentId: string;
  title: string;
  issueDate: string;
  amount: number;
}

interface BillComparison {
  issuer: string;
  currency: string;
  latest: BillRef;
  previous: BillRef[];
  previousAmount?: number;
  percentVsAverage?: number;
  averageAmount?: number;
  trend: "higher" | "lower" | "about_the_same" | "no_history";
  // Only when the latest and an earlier bill state their usage in the same unit.
  usageUnit?: string;
  usageQuantity?: number;
  usagePercentVsAverage?: number;
  usageTrend?: ChangeTrend;
  unitPrice?: number;
  unitPricePercentVsAverage?: number;
  unitPriceTrend?: ChangeTrend;
}

type ChangeTrend = "higher" | "lower" | "about_the_same";

interface ComparisonData {
  query?: string;
  issuer?: string;
  found: boolean;
  comparison?: BillComparison;
  comparisons?: BillComparison[];
}

interface BriefData {
  days: number;
  deadlines: DeadlineItem[];
  renewals: {
    documentId: string;
    title: string;
    issuer: string;
    renewalDate: string;
    cancelBy: string;
    daysToCancel: number;
    amount?: number;
    currency?: string;
  }[];
  warrantiesEndingSoon: WarrantyInfo[];
  higherBills: BillComparison[];
}

// Each card (or row) fades and slides in a little after the one before it.
export const STAGGER_MS = 70;
const BASE_DELAY_MS = 140;
export const delayFor = (index: number) => BASE_DELAY_MS + index * STAGGER_MS;
const enterStyle = (index: number) => ({ "--delay": `${delayFor(index)}ms` }) as CSSProperties;

const label = (value: string) => value.replace(/_/g, " ");

function CountUp({ value, delay, format }: { value: number; delay: number; format: (n: number) => string }) {
  return <>{format(useCountUp(value, delay))}</>;
}

// "today", "tomorrow", "in 9 days" (counting up), "3 days ago". Amber when 7 days or less.
export function DaysPill({ days, delay, onPaper = false }: { days: number; delay: number; onPaper?: boolean }) {
  const counted = Math.round(useCountUp(Math.max(days, 0), delay));
  let text: string;
  if (days < 0) text = `${-days} days ago`;
  else if (days === 0) text = "today";
  else if (days === 1) text = "tomorrow";
  else text = `in ${Math.max(2, counted)} days`;

  const tone = days < 0 ? styles.pillOverdue : days <= 7 ? styles.pillUrgent : onPaper ? styles.pillPaper : "";
  return <span className={`${styles.pill} ${tone}`}>{text}</span>;
}

function DateBlock({ iso }: { iso: string }) {
  const date = new Date(`${iso}T00:00:00Z`);
  const month = date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return (
    <div className={styles.dateBlock}>
      <span className={styles.dateMonth}>{month}</span>
      <span className={styles.dateDay}>{date.getUTCDate()}</span>
    </div>
  );
}

export function DeadlineRow({ item, index, compact = false }: { item: DeadlineItem; index: number; compact?: boolean }) {
  const delay = delayFor(index);
  return (
    <div className={`${styles.card} ${styles.deadlineRow} ${compact ? styles.compact : ""} ${styles.enter}`} style={enterStyle(index)}>
      <DateBlock iso={item.date} />
      <div className={styles.deadlineText}>
        {/* "fridge warranty ends" (built from a product name) starts with a capital letter. */}
        <div className={styles.deadlineTitle}>{capitalizeFirst(item.description)}</div>
        <div className={styles.deadlineIssuer}>{item.issuer}</div>
      </div>
      <div className={styles.deadlineMeta}>
        {item.amount !== undefined && (
          <span className={styles.amount}>
            <CountUp value={item.amount} delay={delay} format={(n) => formatMoney(n, item.currency)} />
          </span>
        )}
        <DaysPill days={item.daysLeft} delay={delay} />
      </div>
    </div>
  );
}

const VISIBLE_DEADLINES = 5;

const KIND_PLURALS: Record<string, string> = {
  payment_due: "payments",
  renewal: "renewals",
  reply_by: "reply-by dates",
  warranty_ends: "warranty end dates",
  appointment: "appointments",
};

export function DeadlinesCard({ data }: { data: Record<string, unknown> }) {
  const deadlines = (data.deadlines as DeadlineItem[] | undefined) ?? [];
  // The item asked for has no deadline: say so above the list of other upcoming ones.
  const missing =
    typeof data.query === "string" && data.found === false
      ? `No match for “${data.query}” · upcoming ${KIND_PLURALS[String(data.kind)] ?? (data.payable ? "payments" : "deadlines")}`
      : undefined;
  const note = missing && (
    <div className={`${styles.eyebrow} ${styles.enter}`} style={enterStyle(0)}>
      {missing}
    </div>
  );
  if (deadlines.length === 0) {
    return (
      <div className={styles.stack}>
        {note}
        <div className={`${styles.card} ${styles.emptyCard} ${styles.enter}`} style={enterStyle(0)}>
          Nothing due in this period. Enjoy the quiet.
        </div>
      </div>
    );
  }
  const visible = deadlines.slice(0, VISIBLE_DEADLINES);
  const total = deadlines.reduce((sum, d) => sum + (d.amount ?? 0), 0);
  return (
    <div className={styles.stack}>
      {note}
      {visible.map((item, i) => (
        <DeadlineRow key={`${item.date}-${item.description}`} item={item} index={i} />
      ))}
      <div className={`${styles.listFooter} ${styles.enter}`} style={enterStyle(visible.length)}>
        <span>
          {deadlines.length > visible.length ? `+${deadlines.length - visible.length} more` : `${deadlines.length} total`}
        </span>
        {total > 0 && (
          <span>
            Total{" "}
            <strong className={styles.amount}>
              <CountUp value={total} delay={delayFor(visible.length)} format={(n) => formatMoney(n, visible[0].currency)} />
            </strong>
          </span>
        )}
      </div>
    </div>
  );
}

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldName}>{name}</span>
      <span className={styles.fieldValue}>{children}</span>
    </div>
  );
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export function DocumentCard({ data }: { data: Record<string, unknown> }) {
  const doc = data.document as DocumentData;
  const today = todayISO();
  const next = [...doc.deadlines].sort((a, b) => a.date.localeCompare(b.date)).find((d) => d.date >= today);
  return (
    <div className={`${styles.paper} ${styles.enter}`} style={enterStyle(0)}>
      <div className={styles.paperHeader}>
        <span className={styles.savedBadge}>
          <CheckIcon /> Saved
        </span>
        <span className={styles.paperTag}>{label(doc.type)}</span>
      </div>
      <h3 className={styles.paperTitle}>{doc.title}</h3>
      <p className={styles.paperSub}>{doc.summary}</p>
      <div className={styles.fieldGrid}>
        <Field name="Issuer">{doc.issuer}</Field>
        <Field name="Amount">
          {doc.amount !== undefined ? (
            <CountUp value={doc.amount} delay={delayFor(1)} format={(n) => formatMoney(n, doc.currency)} />
          ) : (
            "–"
          )}
        </Field>
        <Field name="Issued">{doc.issueDate ? formatSpokenDate(doc.issueDate) : "–"}</Field>
        <Field name="Next deadline">
          {next ? (
            <span className={styles.inline}>
              {formatSpokenDate(next.date)} <DaysPill days={daysBetween(today, next.date)} delay={delayFor(1)} onPaper />
            </span>
          ) : (
            "None"
          )}
        </Field>
      </div>
      {doc.actionItems.length > 0 && (
        <ul className={styles.actionList}>
          {doc.actionItems.slice(0, 3).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Share of the warranty already used. Without a purchase date, assume a 2-year warranty.
function usedShare(warranty: WarrantyInfo): number {
  const total = warranty.startDate ? daysBetween(warranty.startDate, warranty.endDate) : 730;
  return warranty.expired ? 1 : Math.min(1, Math.max(0, 1 - warranty.daysRemaining / Math.max(total, 1)));
}

function barTone(warranty: WarrantyInfo): string {
  return warranty.expired ? styles.barOverdue : warranty.daysRemaining <= 60 ? styles.barUrgent : "";
}

const STATUS_LABEL = { active: "Active", expiring_soon: "Expiring soon", expired: "Expired" };
const STATUS_PILL = { active: "", expiring_soon: styles.pillUrgent, expired: styles.pillOverdue };

export function WarrantyCard({ data }: { data: Record<string, unknown> }) {
  const { warranty, product, warranties } = data as unknown as WarrantyData;
  const days = useCountUp(Math.max(warranty?.daysRemaining ?? 0, 0), delayFor(0), 900);
  if (warranties) return <WarrantyList warranties={warranties} />;
  if (!warranty) {
    return (
      <div className={`${styles.card} ${styles.emptyCard} ${styles.enter}`} style={enterStyle(0)}>
        No warranty found for “{product}”.
      </div>
    );
  }

  const used = usedShare(warranty);
  const tone = barTone(warranty);

  return (
    <div className={styles.stack}>
      <div className={`${styles.card} ${styles.warranty} ${styles.enter}`} style={enterStyle(0)}>
        <div className={styles.warrantyHead}>
          <div>
            <div className={styles.eyebrow}>Warranty</div>
            <h3 className={styles.warrantyProduct}>{warranty.product ?? product}</h3>
            <div className={styles.deadlineIssuer}>{warranty.issuer}</div>
          </div>
          <div className={styles.bigNumber}>
            <span className={warranty.expired ? styles.overdueText : ""}>
              {warranty.expired ? "Expired" : Math.round(days)}
            </span>
            {!warranty.expired && <small>days left</small>}
          </div>
        </div>
        <div className={styles.bar} role="img" aria-label={`${Math.round(used * 100)}% of the warranty used`}>
          <div className={`${styles.barFill} ${tone}`} style={{ "--fill": used } as CSSProperties} />
        </div>
        <div className={styles.barLabels}>
          <span>{warranty.startDate ? `Bought ${formatSpokenDate(warranty.startDate)}` : ""}</span>
          <span>
            {warranty.expired ? "Ended" : "Ends"} {formatSpokenDate(warranty.endDate)}
          </span>
        </div>
      </div>
      {warranty.howToClaim.length > 0 && (
        <div className={`${styles.card} ${styles.enter}`} style={enterStyle(1)}>
          <div className={styles.eyebrow}>How to claim</div>
          <ul className={styles.claimList}>
            {warranty.howToClaim.slice(0, 3).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Every warranty on file: product, status, end date and how much of it is used.
function WarrantyList({ warranties }: { warranties: WarrantyInfo[] }) {
  if (warranties.length === 0) {
    return (
      <div className={`${styles.card} ${styles.emptyCard} ${styles.enter}`} style={enterStyle(0)}>
        No warranties on file yet.
      </div>
    );
  }
  return (
    <div className={styles.stack}>
      {warranties.map((warranty, i) => (
        <div key={warranty.documentId} className={`${styles.card} ${styles.warrantyRow} ${styles.enter}`} style={enterStyle(i)}>
          <div className={styles.warrantyRowHead}>
            <div>
              <div className={styles.deadlineTitle}>
                <span className={styles.capitalize}>{warranty.product ?? warranty.title}</span>
              </div>
              <div className={styles.deadlineIssuer}>{warranty.issuer}</div>
            </div>
            <div className={styles.deadlineMeta}>
              <span className={`${styles.pill} ${STATUS_PILL[warranty.status]}`}>{STATUS_LABEL[warranty.status]}</span>
              <span className={styles.warrantyRowDate}>
                {warranty.expired ? "Ended" : "Ends"} {formatSpokenDate(warranty.endDate)}
              </span>
            </div>
          </div>
          <div className={styles.bar} role="img" aria-label={`${Math.round(usedShare(warranty) * 100)}% of the warranty used`}>
            <div className={`${styles.barFill} ${barTone(warranty)}`} style={{ "--fill": usedShare(warranty) } as CSSProperties} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DraftCard({
  data,
  onFirmer,
  busy,
}: {
  data: Record<string, unknown>;
  onFirmer: (draft: DraftData) => void;
  busy: boolean;
}) {
  const draft = data as unknown as DraftData;
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked (e.g. insecure origin); nothing else to do.
    }
  }

  return (
    <div className={`${styles.paper} ${styles.letter} ${styles.enter}`} style={enterStyle(0)}>
      <div className={styles.letterMeta}>
        <span>
          <b>To</b> {draft.document.issuer}
        </span>
        <span className={styles.paperTag}>{draft.tone} tone</span>
      </div>
      <div className={styles.letterSubject}>
        <b>Subject</b> {draft.subject}
      </div>
      <div className={styles.letterBody}>{draft.body}</div>
      <div className={styles.letterActions}>
        <button type="button" className={styles.paperButton} onClick={copy}>
          {copied ? <CheckIcon /> : <CopyIcon />} {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          className={`${styles.paperButton} ${styles.paperButtonGhost}`}
          onClick={() => onFirmer(draft)}
          disabled={busy || draft.tone === "firm"}
        >
          {draft.tone === "firm" ? "Already firm" : "Make it firmer"}
        </button>
      </div>
    </div>
  );
}

export function ExplanationCard({ data }: { data: Record<string, unknown> }) {
  const info = data as unknown as ExplanationData;
  const sections = [
    ["What it means", info.explanation],
    ["If you ignore it", info.consequencesOfInaction],
    ["Next step", info.recommendedNextStep],
  ];
  return (
    <div className={`${styles.paper} ${styles.enter}`} style={enterStyle(0)}>
      <div className={styles.paperHeader}>
        <span className={styles.paperTag}>{info.document.issuer}</span>
      </div>
      <h3 className={styles.paperTitle}>{info.document.title}</h3>
      {sections.map(([title, text], i) => (
        <div key={title} className={`${styles.explainSection} ${styles.enter}`} style={enterStyle(i + 1)}>
          <span className={styles.fieldName}>{title}</span>
          <p>{text}</p>
        </div>
      ))}
      {info.disclaimer && <p className={styles.disclaimer}>{info.disclaimer}</p>}
    </div>
  );
}

export function MatchesCard({ data }: { data: Record<string, unknown> }) {
  const { matches } = data as unknown as MatchesData;
  return (
    <div className={styles.stack}>
      {matches.map((match, i) => (
        <div key={match.id} className={`${styles.card} ${styles.matchRow} ${styles.enter}`} style={enterStyle(i)}>
          <div className={styles.deadlineTitle}>{match.title}</div>
          <div className={styles.deadlineIssuer}>
            {match.issuer} · {label(match.type)}
          </div>
        </div>
      ))}
    </div>
  );
}

// "+22% vs usual" (amber when higher than usual), "About usual", "No history".
function ChangePill({ comparison }: { comparison: BillComparison }) {
  const pct = comparison.percentVsAverage;
  if (comparison.trend === "no_history" || pct === undefined) return <span className={styles.pill}>No history</span>;
  if (comparison.trend === "about_the_same") return <span className={styles.pill}>About usual</span>;
  const tone = comparison.trend === "higher" ? styles.pillUrgent : "";
  return (
    <span className={`${styles.pill} ${tone}`}>
      {pct > 0 ? "+" : "−"}
      {Math.round(Math.abs(pct))}% vs usual
    </span>
  );
}

export function ComparisonCard({ data }: { data: Record<string, unknown> }) {
  const { comparison, comparisons, issuer, query } = data as unknown as ComparisonData;
  if (comparisons) return <ComparisonList comparisons={comparisons} />;
  if (!comparison) {
    return (
      <div className={`${styles.card} ${styles.emptyCard} ${styles.enter}`} style={enterStyle(0)}>
        No bills to compare for “{issuer ?? query}”.
      </div>
    );
  }

  // Newest first, each bar relative to the biggest bill.
  const bills = [comparison.latest, ...comparison.previous];
  const max = Math.max(...bills.map((bill) => bill.amount), 1);
  return (
    <div className={styles.stack}>
      <div className={`${styles.card} ${styles.warranty} ${styles.enter}`} style={enterStyle(0)}>
        <div className={styles.warrantyHead}>
          <div>
            <div className={styles.eyebrow}>Bill comparison</div>
            <h3 className={styles.warrantyProduct}>{comparison.issuer}</h3>
            <div className={styles.billPill}>
              <ChangePill comparison={comparison} />
            </div>
          </div>
          <div className={styles.bigNumber}>
            <span>
              <CountUp value={comparison.latest.amount} delay={delayFor(0)} format={(n) => formatMoney(n, comparison.currency)} />
            </span>
            <small>latest bill</small>
          </div>
        </div>
        {bills.map((bill, i) => (
          <div key={bill.documentId} className={styles.billRow}>
            <div className={styles.barLabels}>
              <span>{i === 0 ? `Latest · ${formatSpokenDate(bill.issueDate)}` : formatSpokenDate(bill.issueDate)}</span>
              <span>{formatMoney(bill.amount, comparison.currency)}</span>
            </div>
            <div className={styles.bar} role="img" aria-label={`${formatMoney(bill.amount, comparison.currency)} bill`}>
              <div
                className={`${styles.barFill} ${i === 0 && comparison.trend === "higher" ? styles.barUrgent : ""}`}
                style={{ "--fill": bill.amount / max } as CSSProperties}
              />
            </div>
          </div>
        ))}
      </div>
      {comparison.averageAmount !== undefined && (
        <div className={`${styles.listFooter} ${styles.enter}`} style={enterStyle(1)}>
          <span>
            Usual <strong className={styles.amount}>{formatMoney(comparison.averageAmount, comparison.currency)}</strong>
          </span>
          {comparison.previousAmount !== undefined && (
            <span>
              Previous <strong className={styles.amount}>{formatMoney(comparison.previousAmount, comparison.currency)}</strong>
            </span>
          )}
        </div>
      )}
      {comparison.usageUnit !== undefined && comparison.usageQuantity !== undefined && comparison.unitPrice !== undefined && (
        <div className={`${styles.listFooter} ${styles.enter}`} style={enterStyle(2)}>
          <span>
            Usage{" "}
            <strong className={styles.amount}>
              {comparison.usageQuantity.toLocaleString("en-US")} {comparison.usageUnit}
            </strong>{" "}
            {changeLabel(comparison.usagePercentVsAverage, comparison.usageTrend)}
          </span>
          <span>
            Per {perUnit(comparison.usageUnit)}{" "}
            <strong className={styles.amount}>{formatUnitPrice(comparison.unitPrice, comparison.currency)}</strong>{" "}
            {changeLabel(comparison.unitPricePercentVsAverage, comparison.unitPriceTrend)}
          </span>
        </div>
      )}
    </div>
  );
}

// "+22%", "−8%" or "about usual", for usage and price per unit.
function changeLabel(pct: number | undefined, trend: ChangeTrend | undefined): string {
  if (pct === undefined || trend === undefined) return "";
  if (trend === "about_the_same") return "· about usual";
  return `· ${pct > 0 ? "+" : "−"}${Math.round(Math.abs(pct))}%`;
}

// One row per company: latest amount and the change vs usual.
function ComparisonList({ comparisons }: { comparisons: BillComparison[] }) {
  if (comparisons.length === 0) {
    return (
      <div className={`${styles.card} ${styles.emptyCard} ${styles.enter}`} style={enterStyle(0)}>
        Not enough bills to compare yet.
      </div>
    );
  }
  return (
    <div className={styles.stack}>
      {comparisons.map((comparison, i) => (
        <BillChangeRow key={comparison.latest.documentId} comparison={comparison} index={i} />
      ))}
    </div>
  );
}

function BillChangeRow({ comparison, index }: { comparison: BillComparison; index: number }) {
  return (
    <div className={`${styles.card} ${styles.matchRow} ${styles.enter}`} style={enterStyle(index)}>
      <div className={styles.warrantyRowHead}>
        <div>
          <div className={styles.deadlineTitle}>{comparison.issuer}</div>
          <div className={styles.deadlineIssuer}>
            {comparison.averageAmount !== undefined
              ? `Usual ${formatMoney(comparison.averageAmount, comparison.currency)}`
              : "First bill on file"}
          </div>
        </div>
        <div className={styles.deadlineMeta}>
          <span className={styles.amount}>{formatMoney(comparison.latest.amount, comparison.currency)}</span>
          <ChangePill comparison={comparison} />
        </div>
      </div>
    </div>
  );
}

// The weekly brief: what's due, renewals you can still cancel, warranties ending soon and bills
// higher than usual. Renewals and warranties reuse the deadline row (date, text, days left).
export function BriefCard({ data }: { data: Record<string, unknown> }) {
  const brief = data as unknown as BriefData;
  const renewals: DeadlineItem[] = brief.renewals.map((r) => ({
    date: r.cancelBy,
    kind: "renewal",
    description: `Cancel before it renews on ${formatSpokenDate(r.renewalDate)}`,
    amount: r.amount,
    currency: r.currency,
    daysLeft: r.daysToCancel,
    documentTitle: r.title,
    issuer: r.issuer,
  }));
  const warranties: DeadlineItem[] = brief.warrantiesEndingSoon.map((w) => ({
    date: w.endDate,
    kind: "warranty_ends",
    description: `${w.product ?? w.title} warranty ends`,
    daysLeft: w.daysRemaining,
    documentTitle: w.title,
    issuer: w.issuer,
  }));

  // One flat list (headings and rows), so every row gets the next stagger delay.
  type Row =
    | { kind: "heading"; title: string }
    | { kind: "deadline"; item: DeadlineItem }
    | { kind: "bill"; comparison: BillComparison };
  const section = (title: string, rows: Row[]): Row[] => (rows.length > 0 ? [{ kind: "heading", title }, ...rows] : []);
  const rows: Row[] = [
    ...section("Due soon", brief.deadlines.slice(0, VISIBLE_DEADLINES).map((item) => ({ kind: "deadline", item }))),
    ...section("Renewals you can cancel", renewals.map((item) => ({ kind: "deadline", item }))),
    ...section("Warranties ending soon", warranties.map((item) => ({ kind: "deadline", item }))),
    ...section("Higher than usual", brief.higherBills.map((comparison) => ({ kind: "bill", comparison }))),
  ];

  if (rows.length === 0) {
    return (
      <div className={`${styles.card} ${styles.emptyCard} ${styles.enter}`} style={enterStyle(0)}>
        Nothing needs your attention in the next {brief.days} days. Enjoy the quiet.
      </div>
    );
  }
  return (
    <div className={styles.stack}>
      {rows.map((row, i) =>
        row.kind === "heading" ? (
          <div key={row.title} className={`${styles.eyebrow} ${styles.briefHeading} ${styles.enter}`} style={enterStyle(i)}>
            {row.title}
          </div>
        ) : row.kind === "deadline" ? (
          <DeadlineRow key={`${row.item.kind}-${row.item.date}-${row.item.issuer}-${row.item.description}`} item={row.item} index={i} compact />
        ) : (
          <BillChangeRow key={`bill-${row.comparison.latest.documentId}`} comparison={row.comparison} index={i} />
        ),
      )}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="5" y="5" width="8.5" height="8.5" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 3.5V3A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
