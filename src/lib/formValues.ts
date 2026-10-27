/**
 * Parsers and limits for the text and number fields on admin and registration
 * forms. The browser enforces none of these — a Server Action receives
 * whatever is posted — so every action checks its own input with them.
 *
 * The number parsers return null for input that should fail the save, so the
 * caller can show its own message.
 */

/** A person's or family's name, a buyer name, a short title. */
export const MAX_NAME_LENGTH = 120;
/** RFC 5321's maximum for a complete address. */
export const MAX_EMAIL_LENGTH = 254;
export const MAX_PHONE_LENGTH = 40;
/** A free-text note or description. */
export const MAX_NOTE_LENGTH = 2000;

/**
 * The largest money amount any form accepts: $1,000,000. Far above anything
 * the pack collects or spends at once, and far below Postgres's 32-bit
 * integer limit (about $21.4 million in cents), so totals built from several
 * amounts can't overflow either.
 */
export const MAX_CENTS = 100_000_000;
/** Default ceiling for a headcount field unless the caller sets its own. */
export const MAX_COUNT = 10_000;

/**
 * A dollar amount as typed ("45", "45.50", ".5") to whole cents. Blank,
 * negative, more than two decimal places, other spellings Number() would
 * accept ("1e3", "0x10", "Infinity") and anything over MAX_CENTS are null.
 */
export function dollarsToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  // Whole dollars are checked before multiplying, so a 400-digit amount can't
  // round-trip through a float on its way to "too large".
  if (whole.length > 7) return null;
  const cents = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  return cents;
}

/**
 * A headcount field. Blank means 0; anything but plain digits ("1e3", "2.0",
 * "-1", "+3") or a value above `max` is null.
 */
export function parseCount(raw: FormDataEntryValue | null, max: number = MAX_COUNT): number | null {
  if (raw !== null && typeof raw !== "string") return null; // a file, not a number
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return 0;
  if (!/^\d{1,9}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (value > max) return null;
  return value;
}

/** count × unit price in cents, or null if the total would exceed MAX_CENTS. */
export function multiplyCents(count: number, unitCents: number): number | null {
  const total = count * unitCents;
  if (!Number.isSafeInteger(total) || total < 0 || total > MAX_CENTS) return null;
  return total;
}

/** Trimmed text from a form field ("" when missing or a file). */
export function textField(raw: FormDataEntryValue | null | undefined): string {
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * One mailbox, plain: no display name, no list, no spaces or angle brackets.
 * Shared so every form that stores or emails an address agrees on the shape.
 */
const EMAIL_PATTERN = /^[^\s@,;<>()"]+@[^\s@,;<>()"]+\.[^\s@,;<>()"]+$/;

export function isValidEmail(value: string): boolean {
  return value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value);
}
