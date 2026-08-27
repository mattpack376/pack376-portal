/*
 * Helpers for `@db.Date` columns, which Prisma hands back as a Date pinned to
 * UTC midnight. Every read and write has to stay in UTC or the day drifts —
 * an Eastern browser renders 2026-08-12T00:00:00Z as "Aug 11". Client
 * components get these values as plain YYYY-MM-DD strings, which is also what
 * <input type="date"> speaks, so nothing has to round-trip through a Date.
 */

const PACK_TIME_ZONE = "America/New_York";

/** A stored date-only value as YYYY-MM-DD, ready for <input type="date">. */
export function toDateOnlyString(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * YYYY-MM-DD (as typed into a date input) back to the UTC-midnight Date the
 * column stores. Blank means "not set"; anything else malformed throws, so a
 * junk value fails the save instead of silently clearing the field.
 */
export function parseDateOnlyString(raw: string | null | undefined): Date | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) throw new Error("Invalid date.");
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid date.");
  return parsed;
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

/** Today in the pack's time zone as YYYY-MM-DD — the default date a leader almost always wants. */
export function todayDateOnlyString(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PACK_TIME_ZONE }).format(new Date());
}
