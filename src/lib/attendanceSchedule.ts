import "server-only";
import { prisma } from "@/lib/prisma";
import { toDateOnlyString } from "@/lib/dateOnly";
import { CAMP_CONRON_SLUG } from "@/lib/tripPageData";

/**
 * All date math here must stay UTC-only (Date.UTC / getUTCDay / setUTCDate).
 * Verified against node_modules/@prisma/adapter-pg: its date write path
 * (formatDate) builds the outgoing string from getUTCFullYear/Month/Date, and
 * its read path installs an identity passthrough for the Postgres `date` type
 * (bypassing pg-types' usual "reinterpret as local time" behavior). Mixing in
 * a local-time Date anywhere in this chain would silently shift the stored
 * day by the server's UTC offset.
 */

export function parseScoutingYear(scoutingYear: string): { startYear: number; endYear: number } {
  const m = /^(\d{4})-(\d{4})$/.exec(scoutingYear.trim());
  if (!m) throw new Error(`Malformed scoutingYear "${scoutingYear}", expected "YYYY-YYYY".`);
  const startYear = Number(m[1]);
  const endYear = Number(m[2]);
  if (endYear !== startYear + 1) {
    throw new Error(`scoutingYear "${scoutingYear}" years must be consecutive.`);
  }
  return { startYear, endYear };
}

/** Every Friday from Sept 1 of startYear through June 30 of endYear, inclusive. */
export function fridaysForScoutingYear(scoutingYear: string): Date[] {
  const { startYear, endYear } = parseScoutingYear(scoutingYear);
  const start = new Date(Date.UTC(startYear, 8, 1)); // Sept 1
  const end = new Date(Date.UTC(endYear, 5, 30)); // June 30

  const first = new Date(start);
  first.setUTCDate(first.getUTCDate() + ((5 - first.getUTCDay() + 7) % 7));

  const fridays: Date[] = [];
  for (const d = new Date(first); d <= end; d.setUTCDate(d.getUTCDate() + 7)) {
    fridays.push(new Date(d));
  }
  return fridays;
}

/**
 * Idempotent — safe to call on every attendance page load. Isolated here
 * (rather than inlined in a page) because every other data-loader in this app
 * is read-only; this is the one place that writes during a render path.
 */
export async function ensureMeetingDates(scoutingYear: string) {
  const fridays = fridaysForScoutingYear(scoutingYear);
  await prisma.meetingDate.createMany({
    data: fridays.map((date) => ({ date })),
    skipDuplicates: true,
  });
}

/** Derives the display scouting-year label for a given meeting date. */
export function scoutingYearForDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth(); // 0-indexed
  return m >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

/**
 * Formats a stored meeting date for display, with an optional event label
 * (see getMeetingEventLabels) appended. Must pin timeZone: "UTC" —
 * these are date-only values stored at UTC midnight, and the server process
 * may not itself run in UTC, so a naive toLocaleDateString() could render
 * the day before.
 */
export function formatMeetingDate(date: Date, eventLabel?: string | null): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
  return eventLabel ? `${formatted} — ${eventLabel}` : formatted;
}

/**
 * Friday meeting dates that are really a trip's departure day, as
 * YYYY-MM-DD → label, so the attendance lists can say so. Read from the Camp
 * Conron trip page's start date rather than hard-coded, so it follows the
 * trip if the admin moves the dates.
 */
export async function getMeetingEventLabels(): Promise<Map<string, string>> {
  const trip = await prisma.tripPage.findUnique({ where: { slug: CAMP_CONRON_SLUG }, select: { startDate: true } });
  const labels = new Map<string, string>();
  if (trip?.startDate) labels.set(toDateOnlyString(trip.startDate), "Camp Conron");
  return labels;
}

export function eventLabelFor(labels: Map<string, string>, date: Date): string | null {
  return labels.get(toDateOnlyString(date)) ?? null;
}
