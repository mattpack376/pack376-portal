/*
 * Types and pure helpers for the public Calendar of Events (/calendar) and its
 * admin editor. The events themselves live in the CalendarEvent table
 * (prisma/schema.prisma); this module has no database access, so the client
 * component can import it.
 *
 * Dates are plain YYYY-MM-DD strings and never go through a Date in local
 * time — see dateOnly.ts for why a date-only value that round-trips through
 * the browser's time zone drifts a day. Weekday and month names are derived
 * here from the UTC calendar.
 *
 * Categories mirror the color coding of the Google Doc the calendar started as:
 *   camping      red     — campouts
 *   pack-night   gold    — pack-wide nights (parties, derby, carnival, graduation)
 *   one-day      green   — one-day outings and events
 *   fundraiser   cream   — fundraisers (red bold text in the doc)
 *   scout-sunday purple  — the monthly Scout Sunday Mass
 *   general      white   — everything else (registration nights, etc.)
 *   meeting      —       — the regular Friday meeting; generated, never stored
 */

import type { CalendarCategory as DbCategory } from "@/generated/prisma/enums";

export type CalendarCategory =
  | "camping"
  | "pack-night"
  | "one-day"
  | "fundraiser"
  | "scout-sunday"
  | "general"
  | "meeting";

/** The categories an admin can pick; "meeting" is only ever generated. */
export type StoredCategory = Exclude<CalendarCategory, "meeting">;

export const CATEGORIES: { value: StoredCategory; db: DbCategory; label: string; glance: boolean }[] = [
  { value: "camping", db: "CAMPING", label: "Camping trip", glance: true },
  { value: "pack-night", db: "PACK_NIGHT", label: "Pack night", glance: true },
  { value: "one-day", db: "ONE_DAY", label: "One-day event", glance: true },
  { value: "fundraiser", db: "FUNDRAISER", label: "Fundraiser", glance: true },
  { value: "scout-sunday", db: "SCOUT_SUNDAY", label: "Scout Sunday", glance: false },
  { value: "general", db: "GENERAL", label: "Other (no color)", glance: false },
];

export function categoryFromDb(db: DbCategory): StoredCategory {
  return CATEGORIES.find((c) => c.db === db)!.value;
}

export function categoryToDb(value: string): DbCategory | null {
  return CATEGORIES.find((c) => c.value === value)?.db ?? null;
}

/** Categories that can be featured in the Year at a Glance box. */
export const GLANCE_CATEGORIES = CATEGORIES.filter((c) => c.glance).map((c) => c.value);

/** The colored label on an event row; the regular meeting and uncolored events have none. */
export const CATEGORY_PILL: Record<CalendarCategory, { icon: string; label: string } | null> = {
  camping: { icon: "⛺", label: "Camping" },
  "pack-night": { icon: "🎟️", label: "Pack Night" },
  "one-day": { icon: "☀️", label: "One-Day Event" },
  fundraiser: { icon: "💵", label: "Fundraiser" },
  "scout-sunday": { icon: "⛪", label: "Scout Sunday" },
  general: null,
  meeting: null,
};

export const AUDIENCE_LABELS = { leaders: "Leaders & Volunteers", "all-hands": "All Hands on Deck" } as const;
export type Audience = keyof typeof AUDIENCE_LABELS;

/** An event as the public page shows it: always dated. */
export interface CalendarEvent {
  /** First (or only) day, YYYY-MM-DD. */
  date: string;
  /** Last day of a multi-day event, inclusive. */
  endDate?: string;
  /** Set when the two dates are alternatives ("Sat or Sun") rather than a span. */
  eitherDay?: boolean;
  title: string;
  /** Time, place, or a short note shown under the title. */
  detail?: string;
  category: CalendarCategory;
  /** Setup/planning nights for adults — not scheduled activities for scouts. */
  volunteer?: Audience;
  noMeeting?: boolean;
  tbd?: boolean;
  /** A note important enough to bold, like "first meeting, full uniform". */
  important?: boolean;
  link?: { href: string; label: string };
}

/** An event as the admin editor sees it: every column, dates as strings (null when not set). */
export interface AdminCalendarEvent {
  id: string;
  title: string;
  detail: string | null;
  category: StoredCategory;
  date: string | null;
  endDate: string | null;
  eitherDay: boolean;
  audience: Audience | null;
  noMeeting: boolean;
  tbd: boolean;
  important: boolean;
  linkUrl: string | null;
  linkLabel: string | null;
  glance: boolean;
  glanceLabel: string | null;
  glanceWhen: string | null;
  visible: boolean;
}

/** The regular Friday meeting — see CalendarMeetingRule in the schema. */
export interface MeetingRule {
  enabled: boolean;
  title: string;
  detail: string | null;
  startDate: string;
  endDate: string;
}

export interface GlanceItem {
  label: string;
  when: string;
  /** "YYYY-MM" of the month section to jump to; absent for an event with no date yet. */
  month?: string;
}

export interface GlanceGroup {
  category: "camping" | "pack-night" | "one-day" | "fundraiser";
  title: string;
  items: GlanceItem[];
}

export const GLANCE_TITLES: Record<GlanceGroup["category"], string> = {
  camping: "Camping Trips",
  "pack-night": "Pack Night Events",
  "one-day": "One Day Events",
  fundraiser: "Fundraisers",
};

const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const FRIDAY = 5;

function parts(iso: string): { y: number; m: number; d: number; dow: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** A YYYY-MM-DD plus a number of days (negative goes back). */
export function addDays(iso: string, days: number): string {
  const { y, m, d } = parts(iso);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** "2026-10" -> "October 2026". */
export function monthTitle(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return `${MONTH_LONG[m - 1]} ${y}`;
}

/** True once every day of the month is behind `today` ("2026-09" is past on 2026-10-01; the current month never is). */
export function isMonthPast(monthKey: string, today: string): boolean {
  const [y, m] = monthKey.split("-").map(Number);
  const lastDayOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${monthKey}-${String(lastDayOfMonth).padStart(2, "0")}` < today;
}

/** "2026-10-04" -> "Oct 4". */
export function shortDate(iso: string): string {
  const { m, d } = parts(iso);
  return `${MONTH_LONG[m - 1].slice(0, 3)} ${d}`;
}

/** "2026-10" -> "Oct". */
export function monthShort(monthKey: string): string {
  return MONTH_LONG[Number(monthKey.split("-")[1]) - 1].slice(0, 3);
}

/** Every month key from `first` through `last` inclusive, so a month with no events still gets a heading. */
export function monthsBetween(first: string, last: string): string[] {
  const months: string[] = [];
  let [y, m] = first.split("-").map(Number);
  const [endY, endM] = last.split("-").map(Number);
  while (y < endY || (y === endY && m <= endM)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

/**
 * The scouting year shown on the page: July 1 through June 30. It rolls over
 * on July 1 rather than at the first August Friday so next season's calendar
 * can go up over the summer, once it's entered.
 */
export function scoutingYear(today: string): { start: string; end: string; label: string } {
  const { y, m } = parts(today);
  const startYear = m >= 7 ? y : y - 1;
  return { start: `${startYear}-07-01`, end: `${startYear + 1}-06-30`, label: `${startYear}–${startYear + 1}` };
}

/** "Oct 30", "Oct 9–12", "Mar 30 – Apr 2", or "Nov 7/8" for the Year at a Glance box. */
export function dateRangeLabel(date: string, endDate?: string | null, eitherDay?: boolean): string {
  if (!endDate) return shortDate(date);
  const a = parts(date);
  const b = parts(endDate);
  if (eitherDay) return `${MONTH_LONG[a.m - 1].slice(0, 3)} ${a.d}/${b.d}`;
  return a.m === b.m && a.y === b.y ? `${shortDate(date)}–${b.d}` : `${shortDate(date)} – ${shortDate(endDate)}`;
}

/** The two lines of the calendar-leaf date badge: "Fri–Mon" over "9–12". */
export function badgeParts(e: Pick<CalendarEvent, "date" | "endDate" | "eitherDay">): { top: string; bottom: string } {
  const start = parts(e.date);
  if (!e.endDate) return { top: DOW_SHORT[start.dow], bottom: String(start.d) };
  const end = parts(e.endDate);
  if (e.eitherDay) return { top: `${DOW_SHORT[start.dow]}/${DOW_SHORT[end.dow]}`, bottom: `${start.d}/${end.d}` };
  return { top: `${DOW_SHORT[start.dow]}–${DOW_SHORT[end.dow]}`, bottom: `${start.d}–${end.d}` };
}

/** "Friday, October 9 – Monday, October 12" — for screen readers and the Next Up card. */
export function longDateLabel(e: Pick<CalendarEvent, "date" | "endDate" | "eitherDay">): string {
  const one = (iso: string) => {
    const p = parts(iso);
    return `${DOW_LONG[p.dow]}, ${MONTH_LONG[p.m - 1]} ${p.d}`;
  };
  if (!e.endDate) return one(e.date);
  return e.eitherDay ? `${one(e.date)} or ${one(e.endDate)}` : `${one(e.date)} – ${one(e.endDate)}`;
}

/** Whole days from one YYYY-MM-DD to another (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const a = parts(from);
  const b = parts(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

export function lastDay(e: Pick<CalendarEvent, "date" | "endDate">): string {
  return e.endDate ?? e.date;
}

/**
 * The regular meeting, one entry per Friday from the rule's first through its
 * last date (clipped to the page's window) that has nothing else on it.
 * "Nothing else" is any event covering that day — a campout, a pack night, a
 * registration night, a "No Meeting" row. The one exception is a setup or
 * planning night for adults, which doesn't replace the scouts' meeting.
 */
export function meetingEvents(
  rule: MeetingRule | null,
  events: Pick<CalendarEvent, "date" | "endDate" | "category" | "volunteer">[],
  windowStart: string,
  windowEnd: string,
): CalendarEvent[] {
  if (!rule?.enabled) return [];
  const from = rule.startDate > windowStart ? rule.startDate : windowStart;
  const to = rule.endDate < windowEnd ? rule.endDate : windowEnd;

  const taken = new Set<string>();
  for (const e of events) {
    if (e.category === "general" && e.volunteer) continue;
    // The span is bounded so a mistyped end year can't make this loop for ages.
    const end = lastDay(e) < addDays(e.date, 366) ? lastDay(e) : addDays(e.date, 366);
    for (let day = e.date; day <= end; day = addDays(day, 1)) taken.add(day);
  }

  const meetings: CalendarEvent[] = [];
  let day = from;
  while (parts(day).dow !== FRIDAY) day = addDays(day, 1);
  for (; day <= to; day = addDays(day, 7)) {
    if (!taken.has(day)) {
      meetings.push({ date: day, title: rule.title, detail: rule.detail ?? undefined, category: "meeting" });
    }
  }
  return meetings;
}
