import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  InvalidDateError,
  dateOnlyHasPassed,
  isDateOnlyString,
  parseDateOnlyString,
  readDateOnlyField,
  todayDateOnlyString,
  toDateOnlyString,
} from "@/lib/dateOnly";

describe("isDateOnlyString / parseDateOnlyString (F6)", () => {
  const impossible = [
    "2026-02-30",
    "2026-02-31",
    "2026-04-31",
    "2026-06-31",
    "2026-09-31",
    "2026-11-31",
    "2027-02-29", // not a leap year
    "2100-02-29", // century, not a leap year
    "2026-00-10",
    "2026-13-01",
    "2026-01-00",
    "2026-01-32",
    "0000-01-01",
    "1899-12-31",
    "2201-01-01",
  ];
  const malformed = ["2026-1-5", "26-01-05", "2026/01/05", "2026-01-05T00:00", " 2026-01-05x", "tomorrow", "20260105"];

  for (const value of [...impossible, ...malformed]) {
    it(`rejects ${JSON.stringify(value)}`, () => {
      assert.equal(isDateOnlyString(value), false);
      assert.throws(() => parseDateOnlyString(value), InvalidDateError);
    });
  }

  it("accepts real dates, including leap days", () => {
    for (const value of ["2028-02-29", "2000-02-29", "2026-02-28", "2026-12-31", "2026-01-01", "1900-01-01", "2200-12-31"]) {
      assert.equal(isDateOnlyString(value), true, value);
      assert.equal(toDateOnlyString(parseDateOnlyString(value)), value);
    }
  });

  it("stores UTC midnight for the typed day", () => {
    assert.equal(parseDateOnlyString("2026-03-08")?.toISOString(), "2026-03-08T00:00:00.000Z");
  });

  it("keeps blank meaning 'not set'", () => {
    assert.equal(parseDateOnlyString(""), null);
    assert.equal(parseDateOnlyString("   "), null);
    assert.equal(parseDateOnlyString(null), null);
    assert.equal(parseDateOnlyString(undefined), null);
  });

  it("trims surrounding whitespace before validating", () => {
    assert.equal(toDateOnlyString(parseDateOnlyString(" 2026-10-27 ")), "2026-10-27");
  });

  it("carries the caller's message", () => {
    assert.throws(() => parseDateOnlyString("2026-02-31", "Invalid payment date."), /Invalid payment date\./);
  });

  it("readDateOnlyField returns a message instead of throwing", () => {
    assert.deepEqual(readDateOnlyField("", "Start date"), { date: null });
    assert.deepEqual(readDateOnlyField("2026-04-31", "Start date"), { error: "Start date isn't a real date." });
    assert.equal(readDateOnlyField("2026-04-30", "Start date").date?.toISOString(), "2026-04-30T00:00:00.000Z");
    assert.deepEqual(readDateOnlyField(new File(["x"], "x.txt"), "Start date"), { date: null });
  });
});

describe("date-only values across daylight-saving changes", () => {
  // Spring forward (Mar 8 2026) and fall back (Nov 1 2026) in New York.
  for (const day of ["2026-03-08", "2026-03-09", "2026-11-01", "2026-11-02"]) {
    it(`${day} parses and prints back unchanged`, () => {
      assert.equal(toDateOnlyString(parseDateOnlyString(day)), day);
    });
  }

  it("today's date is Eastern, not UTC, around the evening rollover", () => {
    // 11:30 PM Eastern on Nov 1 (after fall-back) is already Nov 2 in UTC.
    assert.equal(todayDateOnlyString(new Date("2026-11-02T04:30:00Z")), "2026-11-01");
    // 11:30 PM Eastern on Mar 7 (before spring-forward).
    assert.equal(todayDateOnlyString(new Date("2026-03-08T04:30:00Z")), "2026-03-07");
  });

  it("a deadline runs through the end of its Eastern day", () => {
    const deadline = parseDateOnlyString("2026-11-01") as Date;
    assert.equal(dateOnlyHasPassed(deadline, new Date("2026-11-02T04:30:00Z")), false);
    assert.equal(dateOnlyHasPassed(deadline, new Date("2026-11-02T05:30:00Z")), true);
  });
});
