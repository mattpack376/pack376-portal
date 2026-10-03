import "server-only";
import { prisma } from "@/lib/prisma";
import { MEETING_LABEL_MAX_LENGTH } from "@/lib/meetingLabel";

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

/** Sept 1 of startYear through June 30 of endYear, inclusive — the span a season's meetings fall in. */
export function attendanceWindowForScoutingYear(scoutingYear: string): { start: Date; end: Date } {
  const { startYear, endYear } = parseScoutingYear(scoutingYear);
  return { start: new Date(Date.UTC(startYear, 8, 1)), end: new Date(Date.UTC(endYear, 5, 30)) };
}

/** Every Friday from Sept 1 of startYear through June 30 of endYear, inclusive. */
export function fridaysForScoutingYear(scoutingYear: string): Date[] {
  const { start, end } = attendanceWindowForScoutingYear(scoutingYear);

  const first = new Date(start);
  first.setUTCDate(first.getUTCDate() + ((5 - first.getUTCDay() + 7) % 7));

  const fridays: Date[] = [];
  for (const d = new Date(first); d <= end; d.setUTCDate(d.getUTCDate() + 7)) {
    fridays.push(new Date(d));
  }
  return fridays;
}

/**
 * A regular weekly meeting, as opposed to a date the calendar adds (Scout
 * Sunday). Anything that means "the Friday meeting" — like the parent
 * dashboard's "next meeting" — has to ask this, since both kinds of date share
 * the MeetingDate table.
 */
export function isFridayMeeting(date: Date): boolean {
  return date.getUTCDay() === 5;
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * The Scout Sundays on the public calendar for this season, each with the
 * label its attendance date starts with (the event's own title, so "Scout
 * Sunday · OLG Easter Fair" keeps its tail). Hidden events, ones with no firm
 * date yet (TBD) and "either of two days" events are skipped: there's no one
 * day to take attendance on.
 */
async function scoutSundaysForScoutingYear(scoutingYear: string): Promise<{ date: Date; label: string }[]> {
  const { start, end } = attendanceWindowForScoutingYear(scoutingYear);
  const events = await prisma.calendarEvent.findMany({
    where: { category: "SCOUT_SUNDAY", visible: true, tbd: false, eitherDay: false, date: { gte: start, lte: end } },
    select: { date: true, title: true },
    orderBy: { date: "asc" },
  });
  const byDay = new Map<string, { date: Date; label: string }>();
  for (const event of events) {
    if (!event.date || byDay.has(isoDay(event.date))) continue;
    const label = event.title.replace(/\s+/g, " ").trim().slice(0, MEETING_LABEL_MAX_LENGTH) || "Scout Sunday";
    byDay.set(isoDay(event.date), { date: event.date, label });
  }
  return [...byDay.values()];
}

/**
 * Idempotent — safe to call on every attendance page load. Isolated here
 * (rather than inlined in a page) because every other data-loader in this app
 * is read-only; this is the one place that writes during a render path.
 *
 * Creates every Friday of the season, plus a date for each Scout Sunday on the
 * calendar (labeled from the event). A date that already exists is left alone,
 * so an edited label or a No Meeting is never overwritten.
 */
export async function ensureMeetingDates(scoutingYear: string) {
  const dates = new Map<string, { date: Date; label?: string }>();
  for (const date of fridaysForScoutingYear(scoutingYear)) dates.set(isoDay(date), { date });
  for (const sunday of await scoutSundaysForScoutingYear(scoutingYear)) {
    if (!dates.has(isoDay(sunday.date))) dates.set(isoDay(sunday.date), sunday);
  }
  await prisma.meetingDate.createMany({ data: [...dates.values()], skipDuplicates: true });
}

/**
 * The meetings to list for a season, oldest first: every Friday, the Scout
 * Sundays still on the calendar, and any other date that already has
 * attendance marked (so moving or deleting a calendar event never hides a
 * record). A calendar date nobody marked that has since left the calendar just
 * drops off — it's never deleted, because deleting would take marks with it.
 * Callers run ensureMeetingDates first.
 */
export async function meetingDatesForYear(scoutingYear: string, options: { scheduledOnly?: boolean } = {}) {
  const { start, end } = attendanceWindowForScoutingYear(scoutingYear);
  const [rows, sundays] = await Promise.all([
    prisma.meetingDate.findMany({
      where: { date: { gte: start, lte: end }, ...(options.scheduledOnly ? { status: "SCHEDULED" as const } : {}) },
      orderBy: { date: "asc" },
      include: { _count: { select: { attendances: true, adultLeaderAttendances: true } } },
    }),
    scoutSundaysForScoutingYear(scoutingYear),
  ]);
  const onCalendar = new Set(sundays.map((s) => isoDay(s.date)));
  return rows.filter(
    (row) =>
      isFridayMeeting(row.date) ||
      onCalendar.has(isoDay(row.date)) ||
      row._count.attendances + row._count.adultLeaderAttendances > 0
  );
}

/** Derives the display scouting-year label for a given meeting date. */
export function scoutingYearForDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth(); // 0-indexed
  return m >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

/**
 * Formats a stored meeting date for display, with the meeting's label
 * (MeetingDate.label, e.g. "Camp Conron") appended when it has one. Must pin timeZone: "UTC" —
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
