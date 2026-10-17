import { PACK_TIME_ZONE, toDateOnlyString, todayDateOnlyString } from "@/lib/dateOnly";

/**
 * A meeting's attendance closes to everyone but Admins at noon (pack time) on
 * the calendar day after the meeting: Friday's attendance locks Saturday at
 * 12 PM. Before that, whoever could already take attendance still can.
 *
 * Pure on purpose — no database, no server-only — so the pages, the server
 * actions and a quick script can all share the one rule.
 */
const LOCK_HOUR = 12;

/** The pack-time hour (0-23) right now. */
function packHour(now: Date): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: PACK_TIME_ZONE,
    hour: "numeric",
    hourCycle: "h23",
  }).format(now);
  return Number(hour);
}

/** The calendar day after a stored meeting date, as YYYY-MM-DD. */
function lockDay(meetingDate: Date): string {
  // Date-only values sit at UTC midnight, and UTC has no DST, so +24h is exactly one day.
  return toDateOnlyString(new Date(meetingDate.getTime() + 24 * 60 * 60 * 1000));
}

/** True once noon pack time on the day after the meeting has arrived. */
export function isAttendanceLocked(meetingDate: Date, now: Date = new Date()): boolean {
  const today = todayDateOnlyString(now);
  const day = lockDay(meetingDate);
  return today > day || (today === day && packHour(now) >= LOCK_HOUR);
}

/**
 * Whether a login with this role may edit the meeting's attendance (marks,
 * No Meeting toggle, label). Locked meetings are Admin-only — Junior Admin,
 * Committee Member, Den Leader and Attendance Only all lose editing at the lock.
 */
export function canEditMeetingAttendance(role: string, meetingDate: Date, now: Date = new Date()): boolean {
  return role === "ADMIN" || !isAttendanceLocked(meetingDate, now);
}

/** "Sat, Oct 3 at 12 PM" — when the meeting locks, for the notice on its page. */
export function attendanceLockLabel(meetingDate: Date): string {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(meetingDate.getTime() + 24 * 60 * 60 * 1000));
  return `${day} at 12 PM`;
}

export const ATTENDANCE_LOCKED_MESSAGE =
  "This meeting's attendance is locked. Only an Admin can make changes now.";

/**
 * Splits a season's dates (oldest first) for the attendance lists. A date
 * "passes" when its attendance locks, so Friday stays up top through Saturday
 * morning. `current` is the first scheduled date that hasn't passed — the one
 * to take attendance for — and `upcoming` is everything still ahead in date
 * order, current included, so a No Meeting night just before it still shows.
 */
export function splitMeetingTimeline<T extends { date: Date; status: string }>(
  dates: T[],
  now: Date = new Date()
): { past: T[]; upcoming: T[]; current: T | null } {
  const past = dates.filter((d) => isAttendanceLocked(d.date, now));
  const upcoming = dates.filter((d) => !isAttendanceLocked(d.date, now));
  const current = upcoming.find((d) => d.status === "SCHEDULED") ?? null;
  return { past, upcoming, current };
}

/** What the highlighted date is: tonight's meeting, the next one, or one still open from yesterday. */
export function currentMeetingTag(meetingDate: Date, now: Date = new Date()): string {
  const day = toDateOnlyString(meetingDate);
  const today = todayDateOnlyString(now);
  if (day === today) return "Today";
  if (day > today) return "Up Next";
  return `Still open until ${attendanceLockLabel(meetingDate)}`;
}
