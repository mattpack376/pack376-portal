import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CalendarEvent } from "@/lib/calendarData";
import {
  exportFileName,
  exportText,
  exportWhen,
  fitText,
  layoutMonth,
  miniMonth,
  monthWeeks,
  parseExportFileName,
  wrapNarrow,
  wrapText,
  yearOverview,
  type ExportCalendar,
  type WeekLayout,
} from "@/lib/calendarExport";

// A fixed-width "font": every character is 1 unit wide at size 1.
const mono = (text: string, size: number) => Array.from(text).length * size;

const meeting = (date: string): CalendarEvent => ({ date, title: "Scout Meeting", detail: "7:30 – 9:30 PM", category: "meeting" });

function cal(events: CalendarEvent[]): Pick<ExportCalendar, "events" | "glance"> {
  return { events: [...events].sort((a, b) => a.date.localeCompare(b.date)), glance: [] };
}

/** The chips in one day cell, by slot. */
function cell(week: WeekLayout, col: number) {
  return week.chips.filter((c) => c.startCol <= col && col <= c.endCol).sort((a, b) => a.slot - b.slot);
}

describe("calendar export file names", () => {
  const months = ["2026-08", "2026-09", "2026-11"];

  it("round-trips a month and the full year", () => {
    assert.equal(exportFileName("2026-11", "pdf", "2026–2027"), "pack376-calendar-2026-11.pdf");
    assert.equal(exportFileName("full", "png", "2026–2027"), "pack376-calendar-2026-2027.png");
    assert.deepEqual(parseExportFileName("pack376-calendar-2026-11.pdf", months, "2026–2027"), { scope: "2026-11", format: "pdf" });
    assert.deepEqual(parseExportFileName("pack376-calendar-2026-2027.png", months, "2026–2027"), { scope: "full", format: "png" });
  });

  it("refuses anything that isn't one of this year's files", () => {
    for (const name of [
      "pack376-calendar-2026-10.pdf", // a month with no section on the page
      "pack376-calendar-2025-2026.pdf", // last year
      "pack376-calendar-2026-11.jpg",
      "pack376-calendar-2026-11.pdf?x=1",
      "../pack376-calendar-2026-11.pdf",
      "pack376-calendar-2026-11.PDF",
      "pack376-calendar-2026-1.pdf",
    ]) {
      assert.equal(parseExportFileName(name, months, "2026–2027"), null, name);
    }
    assert.equal(parseExportFileName("pack376-calendar-2026-2027.pdf", [], "2026–2027"), null, "no full file for an empty calendar");
  });
});

describe("calendar export text", () => {
  it("drops emoji and symbols the fonts can't draw, keeps accents and dashes", () => {
    assert.equal(exportText("🎃 Halloween  Pack Night 🎟️"), "Halloween Pack Night");
    assert.equal(exportText("Piñata — “Fiesta” Night…"), "Piñata — “Fiesta” Night…");
    assert.equal(exportText(null), "");
  });

  it("fits and wraps with an ellipsis only when something was cut", () => {
    assert.equal(fitText("Camp Conron", mono, 1, 20), "Camp Conron");
    assert.equal(fitText("Camp Conron Fall Campout", mono, 1, 10), "Camp Conr…");
    assert.deepEqual(wrapText("one two three four", mono, 1, 9), ["one two", "three", "four"]);
    const clipped = wrapText("one two three four five", mono, 1, 9, 2);
    assert.equal(clipped.length, 2);
    assert.ok(clipped[1].endsWith("…"), clipped[1]);
    assert.ok(clipped.every((l) => mono(l, 1) <= 9));
  });

  it("wraps a chip at hyphens and hyphenates a word too long for the box", () => {
    assert.deepEqual(wrapNarrow("Bring-a-Friend Night", mono, 1, 9, 3), ["Bring-a-", "Friend", "Night"]);
    assert.deepEqual(wrapNarrow("Parish Anniversary", mono, 1, 8, 3), ["Parish", "Anniver-", "sary"]);
    assert.deepEqual(wrapNarrow("Scout Meeting", mono, 1, 8, 3), ["Scout", "Meeting"]);
    const clipped = wrapNarrow("Parish Anniversary Chartering Organization", mono, 1, 8, 3);
    assert.equal(clipped.length, 3);
    assert.ok(clipped[2].endsWith("…"), clipped[2]);
    assert.ok(clipped.every((l) => mono(l, 1) <= 8), clipped.join("|"));
  });

  it("labels dates the way the details list reads them", () => {
    assert.equal(exportWhen({ date: "2026-11-06" }), "Fri, Nov 6");
    assert.equal(exportWhen({ date: "2026-10-30", endDate: "2026-11-01" }), "Fri, Oct 30 – Sun, Nov 1");
    assert.equal(exportWhen({ date: "2026-11-07", endDate: "2026-11-08", eitherDay: true }), "Sat, Nov 7 or Sun, Nov 8");
  });
});

describe("calendar export month grid", () => {
  it("covers a month in Sunday-first weeks: 6 rows when the 1st is a Saturday", () => {
    // August 2026 starts on a Saturday and has 31 days.
    const weeks = monthWeeks("2026-08");
    assert.equal(weeks.length, 6);
    assert.equal(weeks[0][0], "2026-07-26");
    assert.equal(weeks[0][6], "2026-08-01");
    assert.equal(weeks[5][1], "2026-08-31");
    // February 2026 starts on a Sunday: exactly four rows.
    assert.equal(monthWeeks("2026-02").length, 4);
  });

  it("draws a trip across a month boundary in both months, clipped to each", () => {
    const trip: CalendarEvent = { date: "2026-10-30", endDate: "2026-11-01", title: "Fall Campout", category: "camping" };
    const october = layoutMonth(cal([trip]), "2026-10", 4);
    const lastWeek = october.weeks[october.weeks.length - 1];
    const octChip = lastWeek.chips.find((c) => c.text === "Fall Campout")!;
    assert.deepEqual([octChip.startCol, octChip.endCol, octChip.continuesBefore, octChip.continuesAfter], [5, 6, false, true]);
    assert.equal(lastWeek.days[0].inMonth, true); // Oct 25
    assert.equal(october.details.length, 1);

    const november = layoutMonth(cal([trip]), "2026-11", 4);
    const novChip = november.weeks[0].chips.find((c) => c.text === "Fall Campout")!;
    assert.deepEqual([novChip.startCol, novChip.endCol, novChip.continuesBefore, novChip.continuesAfter], [0, 0, true, false]);
    assert.equal(november.details[0].when, "Fri, Oct 30 – Sun, Nov 1", "the trip is listed in November too");
  });

  it("breaks a trip that runs Saturday to Monday into two pieces, one per week", () => {
    const trip: CalendarEvent = { date: "2026-11-14", endDate: "2026-11-16", title: "Long Weekend", category: "camping" };
    const layout = layoutMonth(cal([trip]), "2026-11", 4);
    const pieces = layout.weeks.flatMap((w, r) => w.chips.map((c) => ({ r, ...c })));
    assert.deepEqual(
      pieces.map((p) => [p.r, p.startCol, p.endCol, p.continuesBefore, p.continuesAfter]),
      [
        [1, 6, 6, false, true],
        [2, 0, 1, true, false],
      ],
    );
  });

  it("puts a Friday's meeting above that night's pack night, and sums meetings up in one line", () => {
    const events = cal([
      meeting("2026-11-06"),
      { date: "2026-11-06", title: "Pack Night: Pinewood Derby", category: "pack-night", important: true },
      meeting("2026-11-13"),
      meeting("2026-11-20"),
    ]);
    const layout = layoutMonth(events, "2026-11", 4);
    const friday = cell(layout.weeks[0], 5); // Nov 1 2026 is a Sunday, so Nov 6 is in the first row
    assert.deepEqual(friday.map((c) => c.text), ["Scout Meeting", "Pack Night: Pinewood Derby"]);
    assert.equal(friday[1].important, true);
    assert.deepEqual(layout.meetings, { title: "Scout Meetings", when: "Fridays: Nov 6, 13, 20", detail: "7:30 – 9:30 PM" });
    assert.deepEqual(layout.details.map((d) => d.title), ["Pack Night: Pinewood Derby"], "meetings aren't listed one by one");
  });

  it("shows a 'Sat or Sun' event on both days, dashed", () => {
    const layout = layoutMonth(
      cal([{ date: "2026-11-07", endDate: "2026-11-08", eitherDay: true, title: "Food Drive", category: "one-day" }]),
      "2026-11",
      4,
    );
    const sat = cell(layout.weeks[0], 6);
    const sun = cell(layout.weeks[1], 0);
    assert.equal(sat.length, 1);
    assert.equal(sun.length, 1);
    assert.ok(sat[0].either && sun[0].either);
    assert.equal(sat[0].endCol, sat[0].startCol, "not a bar across both days");
  });

  it("shades a No Meeting night and names the reason; tags TBD and leader events in the list", () => {
    const layout = layoutMonth(
      cal([
        { date: "2026-11-27", title: "Black Friday — No Meeting", category: "general", noMeeting: true },
        { date: "2026-11-21", title: "Holiday Party", category: "pack-night", tbd: true },
        { date: "2026-11-18", title: "Committee Meeting", category: "general", volunteer: "leaders" },
      ]),
      "2026-11",
      4,
    );
    const week = layout.weeks[3];
    assert.equal(week.days[5].noMeeting, true);
    assert.equal(cell(week, 5)[0].text, "No Meeting: Black Friday");
    assert.equal(cell(week, 5)[0].kind, "no-meeting");
    assert.equal(cell(layout.weeks[2], 6)[0].text, "Holiday Party (TBD)");
    const tags = Object.fromEntries(layout.details.map((d) => [d.title, d.tags]));
    assert.deepEqual(tags["Holiday Party"], ["Date TBD"]);
    assert.deepEqual(tags["Committee Meeting"], ["Leaders & Volunteers"]);
    assert.deepEqual(tags["Black Friday — No Meeting"], ["No Meeting"]);
  });

  it("keeps the last row of a full day for '+N more' and lists everything below the grid", () => {
    const busy = ["A", "B", "C", "D", "E"].map((t): CalendarEvent => ({ date: "2026-11-10", title: t, category: "one-day" }));
    const layout = layoutMonth(cal(busy), "2026-11", 3);
    const week = layout.weeks[1];
    assert.deepEqual(cell(week, 2).map((c) => c.text), ["A", "B"]);
    assert.equal(week.more[2], 3);
    assert.equal(layout.details.length, 5);
  });

  it("splits a trip's bar around a day that had to hide its row", () => {
    const events: CalendarEvent[] = [
      { date: "2026-11-09", title: "X", category: "one-day" },
      { date: "2026-11-10", title: "Y1", category: "one-day" },
      { date: "2026-11-10", title: "Y2", category: "one-day" },
      { date: "2026-11-10", title: "Y3", category: "one-day" },
      { date: "2026-11-08", endDate: "2026-11-12", title: "Day Camp", category: "camping" },
    ];
    // Max 2 rows: the trip takes row 0; Tuesday (col 2) has 3 more and keeps row 1 for "+N more".
    const week = layoutMonth(cal(events), "2026-11", 2).weeks[1];
    const camp = week.chips.filter((c) => c.text === "Day Camp");
    assert.deepEqual(camp.map((c) => [c.startCol, c.endCol]), [[0, 4]]);
    assert.equal(week.more[2], 3);
    assert.deepEqual(cell(week, 1).map((c) => c.text), ["Day Camp", "X"]);
  });
});

describe("calendar export year", () => {
  it("lists Scout Sundays, No Meeting nights and the meeting season", () => {
    const overview = yearOverview(
      cal([
        meeting("2026-09-11"),
        meeting("2027-06-11"),
        { date: "2026-09-13", title: "Scout Sunday", category: "scout-sunday" },
        { date: "2026-11-27", title: "No Meeting - Thanksgiving", category: "general", noMeeting: true },
        { date: "2026-12-25", title: "No Meeting", category: "general", noMeeting: true },
      ]),
    );
    assert.deepEqual(overview.scoutSundays, ["Sep 13"]);
    assert.deepEqual(overview.noMeetings, ["Nov 27 · Thanksgiving", "Dec 25"]);
    assert.deepEqual(overview.meetings, { title: "Scout Meetings", when: "Every Friday, Sep 11 – Jun 11", detail: "7:30 – 9:30 PM" });
  });

  it("colors each poster day by its biggest event and marks meeting nights", () => {
    const mini = miniMonth(
      cal([
        meeting("2026-11-06"),
        { date: "2026-11-06", title: "Pack Night", category: "pack-night" },
        meeting("2026-11-13"),
        { date: "2026-11-13", endDate: "2026-11-15", title: "Campout", category: "camping" },
      ]),
      "2026-11",
    );
    const day = (d: number) => mini.weeks.flat().find((x) => x.day === d)!;
    assert.equal(day(6).kind, "pack-night");
    assert.equal(day(6).meeting, true);
    assert.equal(day(14).kind, "camping");
    assert.equal(day(16).kind, null);
    assert.equal(mini.weeks[0][0].day, 1); // Nov 1 2026 is a Sunday
  });
});
