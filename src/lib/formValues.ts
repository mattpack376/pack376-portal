/**
 * Parsers for the number fields on admin and registration forms. Both return
 * null for input that should fail the save, so the caller can show its own
 * message.
 */

/** A dollar amount as typed ("45", "45.50") to whole cents. Blank, negative or non-numeric is null. */
export function dollarsToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** A headcount field. Blank means 0; anything but a non-negative whole number is null. */
export function parseCount(raw: FormDataEntryValue | null): number | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return 0;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}
