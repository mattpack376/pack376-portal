import { PACK_TIME_ZONE, toDateOnlyString, todayDateOnlyString } from "@/lib/dateOnly";

/**
 * A meeting's attendance closes to everyone but Admins at a set pack-time
 * moment after the meeting — by default 9 PM on the calendar day after, so
 * Friday's attendance locks Saturday at 9 PM. Before that, whoever could
 * already take attendance still can.
 *
 * When it locks is the master admin's setting (AttendanceLockSetting in the
 * schema, edited on the Attendance tab); the server reads it with
 * getAttendanceLockRule() in attendanceLockSetting.ts and hands it to these
 * functions. The rule is a required argument on purpose, so no page can fall
 * back to a stale built-in time without the type checker noticing.
 *
 * Pure on purpose — no database, no server-only — so the pages, the server
 * actions and a quick script can all share the one rule.
 */
export type AttendanceLockRule = {
  /** Calendar days after the meeting date: 0 = the meeting day itself, 1 = the next day. */
  daysAfter: number;
  /** Pack-time minute of that day the lock lands on, 0-1439 (21:00 = 1260). */
  minuteOfDay: number;
};

/** 9 PM the day after — used until the master admin saves a different time. */
export const DEFAULT_ATTENDANCE_LOCK_RULE: AttendanceLockRule = { daysAfter: 1, minuteOfDay: 21 * 60 };

/** How far out the lock day can be set: the meeting day through a week after. */
export const MAX_LOCK_DAYS_AFTER = 7;

/** True for a rule the functions below can use — whole numbers inside the allowed ranges. */
export function isValidAttendanceLockRule(rule: AttendanceLockRule): boolean {
  return (
    Number.isInteger(rule.daysAfter) &&
    rule.daysAfter >= 0 &&
    rule.daysAfter <= MAX_LOCK_DAYS_AFTER &&
    Number.isInteger(rule.minuteOfDay) &&
    rule.minuteOfDay >= 0 &&
    rule.minuteOfDay < 24 * 60
  );
}

/** "21:00" (or "21:00:00") from an <input type="time"> as a minute of the day; null if it isn't a real time. */
export function parseLockTimeInput(raw: string): number | null {
  const match = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(raw.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** 1260 → "21:00", the value an <input type="time"> expects. */
export function lockTimeInputValue(minuteOfDay: number): string {
  const hour = Math.floor(minuteOfDay / 60);
  return `${String(hour).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}`;
}

/** The pack-time minute of the day (0-1439) right now. */
function packMinuteOfDay(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACK_TIME_ZONE,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/** The stored meeting date moved `days` calendar days later. */
function addDays(meetingDate: Date, days: number): Date {
  // Date-only values sit at UTC midnight, and UTC has no DST, so +24h is exactly one day.
  return new Date(meetingDate.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * True once the lock moment has arrived. Compares the pack-time calendar date
 * and wall-clock time rather than UTC instants, so DST can't shift it.
 */
export function isAttendanceLocked(meetingDate: Date, rule: AttendanceLockRule, now: Date = new Date()): boolean {
  const today = todayDateOnlyString(now);
  const day = toDateOnlyString(addDays(meetingDate, rule.daysAfter));
  return today > day || (today === day && packMinuteOfDay(now) >= rule.minuteOfDay);
}

/**
 * Whether a login with this role may edit the meeting's attendance (marks,
 * No Meeting toggle, label). Locked meetings are Admin-only — Junior Admin,
 * Committee Member, Den Leader and Attendance Only all lose editing at the lock.
 */
export function canEditMeetingAttendance(
  role: string,
  meetingDate: Date,
  rule: AttendanceLockRule,
  now: Date = new Date()
): boolean {
  return role === "ADMIN" || !isAttendanceLocked(meetingDate, rule, now);
}

/** "9 PM", "12 PM", "12 AM", "9:30 PM" — a minute of the day as pack-style clock text. */
export function lockTimeLabel(minuteOfDay: number): string {
  const hour24 = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const suffix = hour24 < 12 ? "AM" : "PM";
  return minute === 0 ? `${hour12} ${suffix}` : `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/** "the day of the meeting", "the day after the meeting", "3 days after the meeting". */
export function lockDayLabel(daysAfter: number): string {
  if (daysAfter === 0) return "the day of the meeting";
  if (daysAfter === 1) return "the day after the meeting";
  return `${daysAfter} days after the meeting`;
}

/** "9 PM the day after the meeting" — the whole rule in one phrase. */
export function attendanceLockRuleLabel(rule: AttendanceLockRule): string {
  return `${lockTimeLabel(rule.minuteOfDay)} ${lockDayLabel(rule.daysAfter)}`;
}

/** "Sat, Oct 3 at 9 PM" — when the meeting locks, for the notice on its page. */
export function attendanceLockLabel(meetingDate: Date, rule: AttendanceLockRule): string {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(addDays(meetingDate, rule.daysAfter));
  return `${day} at ${lockTimeLabel(rule.minuteOfDay)}`;
}

export const ATTENDANCE_LOCKED_MESSAGE =
  "This meeting's attendance is locked. Only an Admin can make changes now.";

/**
 * Splits a season's dates (oldest first) for the attendance lists. A date
 * "passes" when its attendance locks, so Friday stays up top until the lock.
 * `upcoming` is everything not yet locked, in date order, so a No Meeting
 * night just before the current one still shows. `current` is the scheduled
 * date to take attendance for: today's meeting if there is one, else the most
 * recent meeting still open, else the next one ahead. (With a lock two or more
 * days out, several past meetings can be open at once — the newest wins.)
 */
export function splitMeetingTimeline<T extends { date: Date; status: string }>(
  dates: T[],
  rule: AttendanceLockRule,
  now: Date = new Date()
): { past: T[]; upcoming: T[]; current: T | null } {
  const past = dates.filter((d) => isAttendanceLocked(d.date, rule, now));
  const upcoming = dates.filter((d) => !isAttendanceLocked(d.date, rule, now));
  const today = todayDateOnlyString(now);
  const scheduled = upcoming.filter((d) => d.status === "SCHEDULED");
  const started = scheduled.filter((d) => toDateOnlyString(d.date) <= today);
  const current = started.at(-1) ?? scheduled[0] ?? null;
  return { past, upcoming, current };
}

/** What the highlighted date is: tonight's meeting, the next one, or one still open from an earlier day. */
export function currentMeetingTag(meetingDate: Date, rule: AttendanceLockRule, now: Date = new Date()): string {
  const day = toDateOnlyString(meetingDate);
  const today = todayDateOnlyString(now);
  if (day === today) return "Today";
  if (day > today) return "Up Next";
  return `Still open until ${attendanceLockLabel(meetingDate, rule)}`;
}
