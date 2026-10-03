import "server-only";
import { prisma } from "@/lib/prisma";
import { toDateOnlyString } from "@/lib/dateOnly";
import {
  buildGlance,
  categoryFromDb,
  meetingEvents,
  monthsBetween,
  scoutingYear,
  type AdminCalendarEvent,
  type Audience,
  type CalendarEvent,
  type MeetingRule,
} from "@/lib/calendarData";

type Row = Awaited<ReturnType<typeof prisma.calendarEvent.findMany>>[number];

const AUDIENCE_FROM_DB = { LEADERS: "leaders", ALL_HANDS: "all-hands" } as const satisfies Record<string, Audience>;

// Earliest first; a tie on the date keeps the order the rows were entered in.
const CALENDAR_ORDER = [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }] as const;

function toAdminEvent(row: Row): AdminCalendarEvent {
  return {
    id: row.id,
    title: row.title,
    detail: row.detail,
    category: categoryFromDb(row.category),
    date: toDateOnlyString(row.date),
    endDate: toDateOnlyString(row.endDate),
    eitherDay: row.eitherDay,
    audience: row.audience ? AUDIENCE_FROM_DB[row.audience] : null,
    noMeeting: row.noMeeting,
    tbd: row.tbd,
    important: row.important,
    linkUrl: row.linkUrl,
    linkLabel: row.linkLabel,
    glance: row.glance,
    glanceLabel: row.glanceLabel,
    glanceWhen: row.glanceWhen,
    visible: row.visible,
  };
}

function toPublicEvent(e: AdminCalendarEvent & { date: string }): CalendarEvent {
  return {
    date: e.date,
    endDate: e.endDate ?? undefined,
    eitherDay: e.eitherDay || undefined,
    title: e.title,
    detail: e.detail ?? undefined,
    category: e.category,
    volunteer: e.audience ?? undefined,
    noMeeting: e.noMeeting || undefined,
    tbd: e.tbd || undefined,
    important: e.important || undefined,
    link: e.linkUrl ? { href: e.linkUrl, label: e.linkLabel || "More info" } : undefined,
  };
}

/** The regular Friday meeting setting, or null if it was never set up. */
export async function getMeetingRule(): Promise<MeetingRule | null> {
  const row = await prisma.calendarMeetingRule.findUnique({ where: { id: "main" } });
  if (!row) return null;
  return {
    enabled: row.enabled,
    title: row.title,
    detail: row.detail,
    startDate: toDateOnlyString(row.startDate),
    endDate: toDateOnlyString(row.endDate),
  };
}

/**
 * Fridays an admin cancelled with the attendance page's No Meeting toggle, as
 * YYYY-MM-DD. The public calendar and the Parent Dashboard both drop the
 * regular meeting on these, so a cancellation made only on the attendance
 * side can't leave one of them still promising a meeting.
 */
async function attendanceCancellations(from: string) {
  const rows = await prisma.meetingDate.findMany({
    where: { status: "NO_MEETING", date: { gte: new Date(`${from}T00:00:00.000Z`) } },
    select: { date: true },
  });
  return new Set(rows.map((r) => toDateOnlyString(r.date)));
}

/**
 * Everything the public /calendar page shows for the scouting year containing
 * `today`: the events (with the regular Friday meetings filled in), the month
 * sections to render, and the Year at a Glance box. Hidden events are left out.
 */
export async function getPublicCalendar(today: string) {
  const year = scoutingYear(today);
  const [rows, rule, cancelled] = await Promise.all([
    prisma.calendarEvent.findMany({ where: { visible: true }, orderBy: [...CALENDAR_ORDER] }),
    getMeetingRule(),
    attendanceCancellations(year.start),
  ]);
  const all = rows.map(toAdminEvent);

  const dated = all.filter((e): e is AdminCalendarEvent & { date: string } => !!e.date && e.date >= year.start && e.date <= year.end);
  const events = dated.map(toPublicEvent);
  const meetings = meetingEvents(rule, events, year.start, year.end).filter((m) => !cancelled.has(m.date));
  // The meeting goes first so that on a Friday with a pack night, the meeting
  // (7:30 PM) reads above the event. The sort is stable, so same-day order holds.
  const withMeetings = [...meetings, ...events].sort((a, b) => a.date.localeCompare(b.date));

  const months = withMeetings.length
    ? monthsBetween(withMeetings[0].date.slice(0, 7), withMeetings[withMeetings.length - 1].date.slice(0, 7))
    : [];

  return { yearLabel: year.label, events: withMeetings, months, glance: buildGlance(all, year, today) };
}

/** Every event, past and future, hidden or not, for the admin list. */
export async function getAllCalendarEvents(): Promise<AdminCalendarEvent[]> {
  const rows = await prisma.calendarEvent.findMany({ orderBy: [...CALENDAR_ORDER] });
  return rows.map(toAdminEvent);
}

export async function getCalendarEventById(id: string): Promise<AdminCalendarEvent | null> {
  const row = await prisma.calendarEvent.findUnique({ where: { id } });
  return row ? toAdminEvent(row) : null;
}

/**
 * The calendar as the Parent Dashboard needs it: the visible dated events (as
 * the public page shows them), the Friday meeting rule, and the Fridays an
 * admin cancelled on the attendance side. The dashboard derives both its Next
 * Meeting card (findNextMeeting) and its Upcoming Events list from this one
 * read.
 */
export async function getCalendarForParents(today: string) {
  const [rows, rule, cancelled] = await Promise.all([
    prisma.calendarEvent.findMany({ where: { visible: true, date: { not: null } }, orderBy: [...CALENDAR_ORDER] }),
    getMeetingRule(),
    attendanceCancellations(today),
  ]);
  const events = rows
    .map(toAdminEvent)
    .filter((e): e is AdminCalendarEvent & { date: string } => !!e.date)
    .map(toPublicEvent);
  return { rule, events, cancelled };
}
