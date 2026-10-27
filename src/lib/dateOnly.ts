/*
 * Helpers for `@db.Date` columns, which Prisma hands back as a Date pinned to
 * UTC midnight. Every read and write has to stay in UTC or the day drifts —
 * an Eastern browser renders 2026-08-12T00:00:00Z as "Aug 11". Client
 * components get these values as plain YYYY-MM-DD strings, which is also what
 * <input type="date"> speaks, so nothing has to round-trip through a Date.
 */

export const PACK_TIME_ZONE = "America/New_York";

/** A stored date-only value as YYYY-MM-DD, ready for <input type="date">. */
export function toDateOnlyString(date: Date): string;
export function toDateOnlyString(date: Date | null | undefined): string | null;
export function toDateOnlyString(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Years a date field may hold. Wide enough for any real record (old
 * registrations, imported raffles, trips a year or two out), narrow enough to
 * catch a mistyped year.
 */
const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

/** Thrown by parseDateOnlyString for a value that isn't a real calendar date. */
export class InvalidDateError extends Error {
  constructor(message = "Invalid date.") {
    super(message);
    this.name = "InvalidDateError";
  }
}

/**
 * True for a real calendar date written as YYYY-MM-DD. Date() quietly rolls
 * an impossible date forward ("2026-02-31" becomes March 3), so the parsed
 * value has to print back as exactly what was typed — that rejects February
 * 30/31, April 31, February 29 outside leap years, month 00/13 and day 00/32.
 */
export function isDateOnlyString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  if (year < MIN_YEAR || year > MAX_YEAR) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * YYYY-MM-DD (as typed into a date input) back to the UTC-midnight Date the
 * column stores. Blank means "not set"; anything else that isn't a real
 * calendar date throws InvalidDateError (with `message`, so each form can
 * name its field), so a junk value fails the save instead of silently
 * clearing or shifting the field.
 */
export function parseDateOnlyString(raw: string | null | undefined, message = "Invalid date."): Date | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  if (!isDateOnlyString(trimmed)) throw new InvalidDateError(message);
  return new Date(`${trimmed}T00:00:00.000Z`);
}

/**
 * parseDateOnlyString for a form field whose caller reports problems by
 * returning a message instead of throwing: `{ date }` (null when blank) or
 * `{ error }` naming the field.
 */
export function readDateOnlyField(
  raw: FormDataEntryValue | null | undefined,
  label: string,
): { date: Date | null; error?: undefined } | { date?: undefined; error: string } {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return { date: null };
  if (!isDateOnlyString(trimmed)) return { error: `${label} isn't a real date.` };
  return { date: new Date(`${trimmed}T00:00:00.000Z`) };
}

/** "2026-08-12" -> "Aug 12, 2026". */
export function formatDateOnly(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Today in the pack's time zone, as the UTC-midnight Date a date-only column
 * stores — the cutoff for "upcoming", so anything dated before today drops
 * off. Taking the date in UTC instead would roll over at 8 PM Eastern and hide
 * tonight's event or deadline while the day is still on here.
 */
export function todayDateOnly(now: Date = new Date()): Date {
  return new Date(`${todayDateOnlyString(now)}T00:00:00.000Z`);
}

/** A stored date-only value as "August 12, 2026". */
export function formatLongDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Today in the pack's time zone as YYYY-MM-DD — the default date a leader almost always wants. */
export function todayDateOnlyString(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PACK_TIME_ZONE }).format(now);
}

/**
 * True once a date-only deadline's whole day is over in the pack's time
 * zone, so a deadline runs through midnight Eastern — not midnight UTC,
 * which lands at 7 or 8 PM here.
 */
export function dateOnlyHasPassed(date: Date, now: Date = new Date()): boolean {
  return todayDateOnlyString(now) > toDateOnlyString(date);
}
