// All dates in the app are plain "YYYY-MM-DD" strings. Math is done in UTC so
// the server's timezone never shifts a day; "today" is computed in Mexico City.

export const TIMEZONE = "America/Mexico_City";

export function todayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function parseISO(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function formatISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isISODate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parseISO(value).getTime());
}

export function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

export function addDays(iso: string, days: number): string {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return formatISO(d);
}

/** Adds months keeping the day of month (or `day` if given), clamped to the month's length. */
export function addMonths(iso: string, months: number, day?: number): string {
  const d = parseISO(iso);
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month0 = total - year * 12;
  const wanted = day ?? d.getUTCDate();
  return formatISO(new Date(Date.UTC(year, month0, Math.min(wanted, daysInMonth(year, month0)))));
}

/** Date with the given day of month in the same month as `iso` (clamped). */
export function withDayOfMonth(iso: string, day: number): string {
  return addMonths(iso, 0, day);
}

export function diffDays(from: string, to: string): number {
  return Math.round((parseISO(to).getTime() - parseISO(from).getTime()) / 86_400_000);
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonth(iso: string): string {
  const d = parseISO(iso);
  return withDayOfMonth(iso, daysInMonth(d.getUTCFullYear(), d.getUTCMonth()));
}

export function formatMonthLabel(key: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    parseISO(`${key}-01`),
  );
}

export function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(parseISO(iso));
}
