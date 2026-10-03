import "server-only";
import { prisma } from "@/lib/prisma";
import { toDateOnlyString } from "@/lib/dateOnly";
import {
  buildGlance,
  categoryFromDb,
  findNextMeeting,
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
 * Everything the public /calendar page shows for the scouting year containing
 * `today`: the events (with the regular Friday meetings filled in), the month
 * sections to render, and the Year at a Glance box. Hidden events are left out.
 */
export async function getPublicCalendar(today: string) {
  const year = scoutingYear(today);
  const [rows, rule] = await Promise.all([
    prisma.calendarEvent.findMany({ where: { visible: true }, orderBy: [...CALENDAR_ORDER] }),
    getMeetingRule(),
  ]);
  const all = rows.map(toAdminEvent);

  const dated = all.filter((e): e is AdminCalendarEvent & { date: string } => !!e.date && e.date >= year.start && e.date <= year.end);
  const events = dated.map(toPublicEvent);
  // The meeting goes first so that on a Friday with a pack night, the meeting
  // (7:30 PM) reads above the event. The sort is stable, so same-day order holds.
  const withMeetings = [...meetingEvents(rule, events, year.start, year.end), ...events].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

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
 * What the parent dashboard's "Next Meeting" card shows: the next regular
 * meeting by the calendar (visible events and the meeting rule), minus any
 * Friday an admin cancelled on the attendance side. See findNextMeeting.
 */
export async function getNextMeeting(today: string) {
  const [rows, rule, cancelledRows] = await Promise.all([
    prisma.calendarEvent.findMany({ where: { visible: true, date: { not: null } }, orderBy: [...CALENDAR_ORDER] }),
    getMeetingRule(),
    prisma.meetingDate.findMany({
      where: { status: "NO_MEETING", date: { gte: new Date(`${today}T00:00:00.000Z`) } },
      select: { date: true },
    }),
  ]);
  const events = rows
    .map(toAdminEvent)
    .filter((e): e is AdminCalendarEvent & { date: string } => !!e.date)
    .map(toPublicEvent);
  return findNextMeeting(rule, events, today, new Set(cancelledRows.map((r) => toDateOnlyString(r.date))));
}
