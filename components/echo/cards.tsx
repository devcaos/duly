"use client";

import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { daysBetween, formatMoney, formatSpokenDate } from "@/lib/dates";
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
        <div className={styles.deadlineTitle}>{item.description}</div>
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

export function DeadlinesCard({ data }: { data: Record<string, unknown> }) {
  const deadlines = (data.deadlines as DeadlineItem[] | undefined) ?? [];
  if (deadlines.length === 0) {
    return (
      <div className={`${styles.card} ${styles.emptyCard} ${styles.enter}`} style={enterStyle(0)}>
        Nothing due in this period. Enjoy the quiet.
      </div>
    );
  }
  const visible = deadlines.slice(0, VISIBLE_DEADLINES);
  const total = deadlines.reduce((sum, d) => sum + (d.amount ?? 0), 0);
  return (
    <div className={styles.stack}>
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
