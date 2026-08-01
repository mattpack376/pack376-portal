const PACK_TIME_ZONE = "America/New_York";

function partsInPackTimeZone(date: Date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: PACK_TIME_ZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) parts[part.type] = part.value;
  return parts;
}

/** Minutes to add to a UTC instant to get its America/New_York wall-clock time. */
function packOffsetMinutes(utcGuess: Date): number {
  const p = partsInPackTimeZone(utcGuess);
  const hour = p.hour === "24" ? 0 : Number(p.hour);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second));
  return (asUtc - utcGuess.getTime()) / 60000;
}

/**
 * Parses a <input type="datetime-local"> value ("YYYY-MM-DDTHH:mm"), treating
 * it as America/New_York wall-clock time — the pack's home timezone, same
 * convention as src/app/consent/[token]/page.tsx — and returns the
 * equivalent UTC instant for storage.
 */
export function parsePackDateTimeLocal(value: string): Date {
  const naiveUtc = new Date(`${value}:00.000Z`);
  if (Number.isNaN(naiveUtc.getTime())) throw new Error("Invalid date/time.");
  const offsetMinutes = packOffsetMinutes(naiveUtc);
  return new Date(naiveUtc.getTime() - offsetMinutes * 60000);
}

/** Formats a stored UTC Date as a <input type="datetime-local"> value in America/New_York time. */
export function toPackDateTimeLocalValue(date: Date): string {
  const p = partsInPackTimeZone(date);
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}`;
}

/** Formats a stored UTC Date for display, e.g. "Fri, Aug 1, 2026, 5:00 PM ET". */
export function formatPackDateTime(date: Date): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: PACK_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${formatted} ET`;
}
