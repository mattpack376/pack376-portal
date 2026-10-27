/*
 * Helpers for edit forms whose limits are newer than some saved rows.
 *
 * An edit form loads what's saved and sends all of it back. Before the
 * October 2026 limits, an event's title and description, and a guest group's
 * name, size and amount owed, could be any length or size; such a row would
 * fail every later save of its form, even one that only changes a fee. So the
 * Server Actions accept a value saved before a limit when it comes back
 * unchanged, while anything new or changed has to fit.
 *
 * Plain code with no imports, so pages and client components can use it too.
 */

/** How the edit forms show a saved amount in a dollars field: 4550 → "45.50". */
export function centsFieldText(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * A text's length as the browser's maxLength counts it. A textarea sends each
 * line break as CRLF but counts it as one character, so measuring the raw
 * text would refuse a description typed right up to the limit.
 */
export function textLengthAsTyped(text: string): number {
  return text.replace(/\r\n?/g, "\n").length;
}

/**
 * Whether a text field came back as the form loaded it, ignoring the edges
 * that are trimmed on saving and how its line breaks were sent.
 */
export function isUnchangedText(value: string, saved: string | null | undefined): boolean {
  if (saved === null || saved === undefined) return false;
  const normalize = (text: string) => text.replace(/\r\n?/g, "\n").trim();
  return normalize(value) === normalize(saved);
}
