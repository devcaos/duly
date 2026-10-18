// Date helpers. All dates are plain "YYYY-MM-DD" strings handled in UTC,
// so the server's time zone never shifts a deadline by one day.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// True only for real calendar dates: "2026-02-28" yes, "2026-02-30" or "2026-99-99" no.
export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  // Parse in UTC and check it round-trips to the same string.
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Number of days from `from` to `to` (negative if `to` is in the past).
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / MS_PER_DAY);
}

// "in 6 days", "tomorrow", "today", "3 days ago"
export function describeDaysLeft(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days < 0) return `${-days} days ago`;
  return `in ${days} days`;
}

// "November 14", or "September 12, 2027" when the year isn't the current one (spoken-friendly).
export function formatSpokenDate(iso: string): string {
  return iso.slice(0, 4) === todayISO().slice(0, 4) ? formatMonthDay(iso) : formatLongDate(iso);
}

// "October 5, 2026": always with the year (letters).
export function formatLongDate(iso: string): string {
  return `${formatMonthDay(iso)}, ${iso.slice(0, 4)}`;
}

function formatMonthDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

// Last day of the calendar month of `iso`: "2026-10-17" -> "2026-10-31".
export function endOfMonth(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

// "this month" / "this week" as from/to dates starting today. Sunday ends the week.
export function periodRange(period: "month" | "week", today = todayISO()): { from: string; to: string } {
  if (period === "month") return { from: today, to: endOfMonth(today) };
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return { from: today, to: addDays(today, (7 - weekday) % 7) };
}

export function formatMoney(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

// "$69": rounded to whole units, for approximate amounts like "your usual $69".
export function formatWholeMoney(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(
    amount,
  );
}
