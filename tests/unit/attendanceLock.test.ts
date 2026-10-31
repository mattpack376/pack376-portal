import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ATTENDANCE_LOCK_RULE,
  attendanceLockLabel,
  attendanceLockRuleLabel,
  canEditMeetingAttendance,
  currentMeetingTag,
  isAttendanceLocked,
  isValidAttendanceLockRule,
  lockTimeInputValue,
  lockTimeLabel,
  parseLockTimeInput,
  splitMeetingTimeline,
} from "@/lib/attendanceLock";

/** A stored meeting date (date-only, UTC midnight). */
const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

const friOct = day("2026-10-02"); // Friday, EDT (UTC-4)
const friDec = day("2026-12-04"); // Friday, EST (UTC-5)

describe("default rule: 9 PM the day after", () => {
  const rule = DEFAULT_ATTENDANCE_LOCK_RULE;

  it("is 9 PM the next day", () => {
    assert.deepEqual(rule, { daysAfter: 1, minuteOfDay: 1260 });
    assert.equal(attendanceLockRuleLabel(rule), "9 PM the day after the meeting");
  });

  it("stays open through 8:59:59 PM Saturday and locks at 9 PM (EDT)", () => {
    assert.equal(isAttendanceLocked(friOct, rule, new Date("2026-10-04T00:59:59Z")), false); // Sat 8:59:59 PM
    assert.equal(isAttendanceLocked(friOct, rule, new Date("2026-10-04T01:00:00Z")), true); // Sat 9:00 PM
  });

  it("does the same in EST", () => {
    assert.equal(isAttendanceLocked(friDec, rule, new Date("2026-12-06T01:59:59Z")), false);
    assert.equal(isAttendanceLocked(friDec, rule, new Date("2026-12-06T02:00:00Z")), true);
  });

  it("is open the night of the meeting and Saturday noon, locked from Sunday on", () => {
    assert.equal(isAttendanceLocked(friOct, rule, new Date("2026-10-03T01:30:00Z")), false); // Fri 9:30 PM
    assert.equal(isAttendanceLocked(friOct, rule, new Date("2026-10-03T16:00:00Z")), false); // Sat 12 PM
    assert.equal(isAttendanceLocked(friOct, rule, new Date("2026-10-04T14:00:00Z")), true); // Sun morning
  });

  it("crosses a year end", () => {
    const thu = day("2026-12-31");
    assert.equal(isAttendanceLocked(thu, rule, new Date("2027-01-02T01:59:00Z")), false); // Jan 1 8:59 PM EST
    assert.equal(isAttendanceLocked(thu, rule, new Date("2027-01-02T02:00:00Z")), true);
  });

  it("labels the lock moment", () => {
    assert.equal(attendanceLockLabel(friOct, rule), "Sat, Oct 3 at 9 PM");
  });
});

describe("custom rules", () => {
  it("honors the old noon rule to the minute", () => {
    const noon = { daysAfter: 1, minuteOfDay: 12 * 60 };
    assert.equal(isAttendanceLocked(friOct, noon, new Date("2026-10-03T15:59:59Z")), false);
    assert.equal(isAttendanceLocked(friOct, noon, new Date("2026-10-03T16:00:00Z")), true);
    assert.equal(attendanceLockLabel(friOct, noon), "Sat, Oct 3 at 12 PM");
  });

  it("honors minutes, not just hours", () => {
    const rule = { daysAfter: 1, minuteOfDay: 21 * 60 + 30 };
    assert.equal(isAttendanceLocked(friOct, rule, new Date("2026-10-04T01:29:00Z")), false);
    assert.equal(isAttendanceLocked(friOct, rule, new Date("2026-10-04T01:30:00Z")), true);
    assert.equal(attendanceLockLabel(friOct, rule), "Sat, Oct 3 at 9:30 PM");
  });

  it("can lock the same night", () => {
    const rule = { daysAfter: 0, minuteOfDay: 23 * 60 };
    assert.equal(isAttendanceLocked(friOct, rule, new Date("2026-10-03T02:59:00Z")), false); // Fri 10:59 PM
    assert.equal(isAttendanceLocked(friOct, rule, new Date("2026-10-03T03:00:00Z")), true); // Fri 11 PM
    assert.equal(attendanceLockRuleLabel(rule), "11 PM the day of the meeting");
  });

  it("can wait several days, across the November DST change", () => {
    const rule = { daysAfter: 3, minuteOfDay: 9 * 60 };
    const fri = day("2026-10-30"); // DST ends Sun Nov 1
    assert.equal(isAttendanceLocked(fri, rule, new Date("2026-11-02T13:59:00Z")), false); // Mon 8:59 AM EST
    assert.equal(isAttendanceLocked(fri, rule, new Date("2026-11-02T14:00:00Z")), true); // Mon 9 AM EST
    assert.equal(attendanceLockLabel(fri, rule), "Mon, Nov 2 at 9 AM");
  });

  it("treats midnight as the very start of the lock day", () => {
    const rule = { daysAfter: 1, minuteOfDay: 0 };
    assert.equal(isAttendanceLocked(friOct, rule, new Date("2026-10-03T03:59:59Z")), false); // Fri 11:59:59 PM
    assert.equal(isAttendanceLocked(friOct, rule, new Date("2026-10-03T04:00:00Z")), true); // Sat 12 AM
    assert.equal(lockTimeLabel(0), "12 AM");
  });

  it("lets Admins edit after the lock and nobody else", () => {
    const after = new Date("2026-10-05T12:00:00Z");
    const rule = DEFAULT_ATTENDANCE_LOCK_RULE;
    assert.equal(canEditMeetingAttendance("ADMIN", friOct, rule, after), true);
    for (const role of ["JUNIOR_ADMIN", "COMMITTEE", "DEN", "ATTENDANCE"]) {
      assert.equal(canEditMeetingAttendance(role, friOct, rule, after), false, role);
      assert.equal(canEditMeetingAttendance(role, friOct, rule, new Date("2026-10-03T12:00:00Z")), true, role);
    }
  });
});

describe("timeline", () => {
  it("keeps Friday on top until the saved lock time", () => {
    const dates = [
      { id: "a", date: day("2026-10-02"), status: "SCHEDULED" },
      { id: "b", date: day("2026-10-09"), status: "SCHEDULED" },
    ];
    const satAfternoon = new Date("2026-10-03T18:00:00Z"); // Sat 2 PM EDT
    const nine = splitMeetingTimeline(dates, DEFAULT_ATTENDANCE_LOCK_RULE, satAfternoon);
    assert.equal(nine.current?.id, "a");
    assert.equal(currentMeetingTag(day("2026-10-02"), DEFAULT_ATTENDANCE_LOCK_RULE, satAfternoon), "Still open until Sat, Oct 3 at 9 PM");
    const noon = splitMeetingTimeline(dates, { daysAfter: 1, minuteOfDay: 720 }, satAfternoon);
    assert.equal(noon.current?.id, "b");
    assert.deepEqual(noon.past.map((d) => d.id), ["a"]);
  });
});

describe("timeline with a lock several days out", () => {
  const rule = { daysAfter: 3, minuteOfDay: 1260 };
  const dates = [
    { id: "fri", date: day("2026-10-02"), status: "SCHEDULED" },
    { id: "sun", date: day("2026-10-04"), status: "SCHEDULED" },
    { id: "nextFri", date: day("2026-10-09"), status: "SCHEDULED" },
  ];

  it("highlights today's meeting, not an older one still open", () => {
    const sunday = new Date("2026-10-04T18:00:00Z"); // Sun 2 PM EDT; Friday open until Mon 9 PM
    const { current, upcoming } = splitMeetingTimeline(dates, rule, sunday);
    assert.deepEqual(upcoming.map((d) => d.id), ["fri", "sun", "nextFri"]);
    assert.equal(current?.id, "sun");
    assert.equal(currentMeetingTag(current!.date, rule, sunday), "Today");
  });

  it("between meetings, highlights the newest one still open", () => {
    const tuesday = new Date("2026-10-06T16:00:00Z"); // Friday locked Mon 9 PM; Sunday open until Wed
    assert.equal(splitMeetingTimeline(dates, rule, tuesday).current?.id, "sun");
  });

  it("before any meeting, highlights the next one", () => {
    const before = new Date("2026-09-30T16:00:00Z");
    assert.equal(splitMeetingTimeline(dates, rule, before).current?.id, "fri");
  });
});

describe("rule input", () => {
  it("parses <input type=time> values", () => {
    assert.equal(parseLockTimeInput("21:00"), 1260);
    assert.equal(parseLockTimeInput("00:00"), 0);
    assert.equal(parseLockTimeInput("23:59"), 1439);
    assert.equal(parseLockTimeInput("09:30:00"), 570);
    for (const bad of ["", "9:00", "24:00", "12:60", "9 PM", "21:00x", "-1:00"]) {
      assert.equal(parseLockTimeInput(bad), null, bad);
    }
  });

  it("round-trips the stored minute", () => {
    for (const m of [0, 570, 720, 1260, 1439]) assert.equal(parseLockTimeInput(lockTimeInputValue(m)), m);
  });

  it("validates ranges", () => {
    assert.equal(isValidAttendanceLockRule({ daysAfter: 0, minuteOfDay: 0 }), true);
    assert.equal(isValidAttendanceLockRule({ daysAfter: 7, minuteOfDay: 1439 }), true);
    for (const bad of [
      { daysAfter: -1, minuteOfDay: 0 },
      { daysAfter: 8, minuteOfDay: 0 },
      { daysAfter: 1.5, minuteOfDay: 0 },
      { daysAfter: NaN, minuteOfDay: 0 },
      { daysAfter: 1, minuteOfDay: 1440 },
      { daysAfter: 1, minuteOfDay: -1 },
    ]) {
      assert.equal(isValidAttendanceLockRule(bad), false, JSON.stringify(bad));
    }
  });
});
