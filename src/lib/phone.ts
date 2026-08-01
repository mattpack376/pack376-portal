/**
 * Normalizes a phone number to (###)###-#### when it contains exactly 10
 * digits (after stripping a leading US country code "1"). Anything else
 * (partial input, non-US numbers) is returned trimmed but otherwise
 * untouched, so it doesn't corrupt a value that isn't a standard 10-digit
 * number. Idempotent — safe to call on an already-formatted value.
 */
export function formatPhoneNumber(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  let digits = trimmed.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return trimmed;
  return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
}
