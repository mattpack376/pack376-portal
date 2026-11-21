/*
 * The shareable Calendar of Events: a month, or the whole scouting year, as a
 * PDF or a PNG (src/app/calendar/export/[file]/route.ts, linked from the
 * Download or Share card on /calendar and the admin calendar page).
 *
 * This module is the one layout both renderers read — calendarExportPdf.ts
 * and calendarExportPng.tsx only draw what it decides — so the two files can't
 * disagree about which event sits on which day. It has no database or file
 * access, so tests/unit/calendarExport.test.ts can exercise it directly.
 *
 * It shows exactly what the public page shows: getCalendarExport hands it the
 * same visible events and Friday meetings as getPublicCalendar.
 *
 * Colors are the site's own tokens (the :root block and the .cal-cat--*
 * category colors in globals.css), so a camping trip is the same red on paper
 * as on the page.
 */

import {
  AUDIENCE_LABELS,
  addDays,
  lastDay,
  monthShort,
  monthTitle,
  noMeetingReason,
  shortDate,
  type CalendarCategory,
  type CalendarEvent,
  type GlanceGroup,
} from "@/lib/calendarData";

export type ExportFormat = "pdf" | "png";
/** A month key ("2026-11"), or the whole scouting year. */
export type ExportScope = "full" | string;

/** Everything an export is drawn from (see getCalendarExport). */
export interface ExportCalendar {
  /** "2026–2027". */
  yearLabel: string;
  /** Visible events of the scouting year plus the generated Friday meetings, earliest first. */
  events: CalendarEvent[];
  /** Every month to give a page, first to last. */
  months: string[];
  /** The Year at a Glance cards for the WHOLE year (the page's only list what's still ahead). */
  glance: GlanceGroup[];
  /** The pack's date the file was made, YYYY-MM-DD. */
  generatedOn: string;
}

// ---------------------------------------------------------------------------
// File names
// ---------------------------------------------------------------------------

const FILE_PREFIX = "pack376-calendar-";

/** The shape of every export file name; checked before anything is looked up. */
export const EXPORT_FILE_PATTERN = /^pack376-calendar-(\d{4}-\d{2}|\d{4}-\d{4})\.(pdf|png)$/;

/** "2026–2027" -> "2026-2027" (file names stay plain ASCII). */
function yearKey(yearLabel: string) {
  return yearLabel.replace(/[–—]/g, "-");
}

/** pack376-calendar-2026-11.pdf, pack376-calendar-2026-2027.png. */
export function exportFileName(scope: ExportScope, format: ExportFormat, yearLabel: string): string {
  return `${FILE_PREFIX}${scope === "full" ? yearKey(yearLabel) : scope}.${format}`;
}

/**
 * The scope and format a requested file name stands for, or null when it isn't
 * one of this year's files. Only names exportFileName could have made are
 * accepted — a month that has a page on the calendar, or this year's full
 * calendar — so the set of addresses the route answers (and caches) is small
 * and fixed.
 */
export function parseExportFileName(
  name: string,
  months: readonly string[],
  yearLabel: string,
): { scope: ExportScope; format: ExportFormat } | null {
  const match = EXPORT_FILE_PATTERN.exec(name);
  if (!match) return null;
  const [, key, format] = match as unknown as [string, string, ExportFormat];
  if (months.length > 0 && key === yearKey(yearLabel)) return { scope: "full", format };
  if (months.includes(key)) return { scope: key, format };
  return null;
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

/** The :root tokens in globals.css ("Coney Island x Cub Scout theme"). */
export const EXPORT_COLORS = {
  blue: "#003f87",
  blueDark: "#00285c",
  blueLight: "#1e5fae",
  gold: "#ffc72c",
  goldDark: "#e6a800",
  red: "#e4002b",
  redDark: "#b3001f",
  cream: "#fff8ea",
  creamDark: "#fbecc6",
  ink: "#1a1a2e",
  inkSoft: "#3c3c55",
  white: "#ffffff",
  /** Grid lines and card edges: a darker cream. */
  line: "#dccfae",
  /** Days outside the month. */
  outside: "#f5efe0",
} as const;

/** What colors a chip: an event's category, or a No Meeting night. */
export type ChipKind = CalendarCategory | "no-meeting";

/** The .cal-cat--* tokens in globals.css, as a filled chip. */
export const CHIP_STYLE: Record<ChipKind, { bg: string; fg: string; border?: string }> = {
  camping: { bg: "#e4002b", fg: "#ffffff" },
  "pack-night": { bg: "#ffc72c", fg: "#00285c" },
  "one-day": { bg: "#26803a", fg: "#ffffff" },
  fundraiser: { bg: "#fff5df", fg: "#b3001f", border: "#e4002b" },
  "scout-sunday": { bg: "#6a3fa0", fg: "#ffffff" },
  "no-meeting": { bg: "#efece3", fg: "#4a463c", border: "#b9b3a3" },
  meeting: { bg: "#dde9f8", fg: "#00285c" },
  general: { bg: "#ffffff", fg: "#00285c", border: "#003f87" },
};

/** The color key on every page, in the order of the page's filter chips. */
export const LEGEND: { kind: ChipKind; label: string }[] = [
  { kind: "camping", label: "Camping Trip" },
  { kind: "pack-night", label: "Pack Night" },
  { kind: "one-day", label: "One-Day Event" },
  { kind: "fundraiser", label: "Fundraiser" },
  { kind: "scout-sunday", label: "Scout Sunday" },
  { kind: "meeting", label: "Scout Meeting" },
  { kind: "no-meeting", label: "No Meeting" },
  { kind: "general", label: "Other" },
];

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const EXPORT_SITE = "pack376nyc.org/calendar";
export const EXPORT_DISCLAIMER = "Dates and events can change. Check the website for the latest.";

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * Text both renderers' fonts can draw. Baloo 2 and Poppins cover Latin, Latin
 * Extended-A and the usual punctuation; emoji (an admin might type "🎃
 * Halloween") and other symbols are dropped rather than drawn as boxes or
 * question marks.
 */
export function exportText(raw: string | null | undefined): string {
  if (!raw) return "";
  const kept = Array.from(raw.normalize("NFC")).filter((ch) => {
    const c = ch.codePointAt(0)!;
    return (
      (c >= 0x20 && c <= 0x7e) ||
      (c >= 0xa0 && c <= 0x17f) ||
      (c >= 0x2010 && c <= 0x2027) ||
      (c >= 0x2030 && c <= 0x203a) ||
      c === 0x20ac ||
      c === 0x2122
    );
  });
  return kept.join("").replace(/\s+/g, " ").trim();
}

/** Width of `text` at `size` in a renderer's font. */
export type Measure = (text: string, size: number) => number;

/** The text cut to fit `maxWidth`, ending in "…" when anything was cut. */
export function fitText(text: string, measure: Measure, size: number, maxWidth: number): string {
  if (measure(text, size) <= maxWidth) return text;
  const chars = Array.from(text);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${chars.slice(0, mid).join("").trimEnd()}…`, size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? "" : `${chars.slice(0, lo).join("").trimEnd()}…`;
}

/**
 * Greedy word wrap to at most `maxLines` lines; the last line ends in "…" when
 * text was left over. A word too long for a line on its own is cut to fit.
 */
export function wrapText(text: string, measure: Measure, size: number, maxWidth: number, maxLines = Infinity): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  let i = 0;
  for (; i < words.length; i++) {
    const candidate = line ? `${line} ${words[i]}` : words[i];
    if (measure(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) {
      lines.push(line);
      if (lines.length === maxLines) break;
    }
    line = measure(words[i], size) <= maxWidth ? words[i] : fitText(words[i], measure, size, maxWidth);
  }
  if (lines.length < maxLines && line) {
    lines.push(line);
    i = words.length;
  }
  if (i < words.length && lines.length) {
    const last = lines.length - 1;
    lines[last] = fitText(`${lines[last]}…`, measure, size, maxWidth).replace(/……$/, "…");
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function ymd(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(days).padStart(2, "0")}` };
}

/** "Fri, Nov 6". */
function dayLabel(iso: string) {
  return `${WEEKDAYS[ymd(iso).dow]}, ${shortDate(iso)}`;
}

/** "Fri, Nov 6", "Fri, Oct 30 – Sun, Nov 1", or "Sat, Nov 7 or Sun, Nov 8". */
export function exportWhen(e: Pick<CalendarEvent, "date" | "endDate" | "eitherDay">): string {
  if (!e.endDate) return dayLabel(e.date);
  return `${dayLabel(e.date)} ${e.eitherDay ? "or" : "–"} ${dayLabel(e.endDate)}`;
}

/** "November 21, 2026". */
export function exportLongDate(iso: string): string {
  const { y, d } = ymd(iso);
  return `${monthTitle(iso.slice(0, 7)).split(" ")[0]} ${d}, ${y}`;
}

/** The Sunday-first weeks that cover a month, each seven YYYY-MM-DD dates. */
export function monthWeeks(month: string): string[][] {
  const { first, last } = monthBounds(month);
  let day = addDays(first, -ymd(first).dow);
  const weeks: string[][] = [];
  while (day <= last) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) week.push(addDays(day, i));
    weeks.push(week);
    day = addDays(day, 7);
  }
  return weeks;
}

// ---------------------------------------------------------------------------
// Month grid
// ---------------------------------------------------------------------------

export function chipKind(e: Pick<CalendarEvent, "category" | "noMeeting">): ChipKind {
  return e.noMeeting ? "no-meeting" : e.category;
}

/** What a day cell says for an event: the title, or "No Meeting: Black Friday". */
function chipText(e: CalendarEvent): string {
  if (e.noMeeting) {
    const reason = exportText(noMeetingReason(e.title));
    return reason ? `No Meeting: ${reason}` : "No Meeting";
  }
  const title = exportText(e.title) || "Event";
  return e.tbd ? `${title} (TBD)` : title;
}

export interface PlacedChip {
  text: string;
  kind: ChipKind;
  important: boolean;
  /** One of two alternative days ("Sat or Sun"); drawn with a dashed edge. */
  either: boolean;
  /** Row within the day cells, 0 at the top. */
  slot: number;
  /** Weekday columns it covers, 0 = Sunday, inclusive. */
  startCol: number;
  endCol: number;
  /** The event carries on from the left / to the right of this piece (a trip across weeks or months). */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export interface GridDay {
  date: string;
  day: number;
  inMonth: boolean;
  /** A No Meeting night: the cell is shaded. */
  noMeeting: boolean;
}

export interface WeekLayout {
  days: GridDay[];
  chips: PlacedChip[];
  /** Per weekday column, how many events didn't fit (shown as "+N more"). */
  more: number[];
}

export interface DetailItem {
  when: string;
  title: string;
  detail: string;
  kind: ChipKind;
  /** "Leaders & Volunteers", "No Meeting", "Date TBD". */
  tags: string[];
  important: boolean;
}

export interface MeetingSummary {
  /** "Scout Meetings". */
  title: string;
  /** "Fridays: Nov 6, 13, 20". */
  when: string;
  /** "7:30 – 9:30 PM" (the meeting rule's detail). */
  detail: string;
}

export interface MonthLayout {
  month: string;
  title: string;
  weeks: WeekLayout[];
  details: DetailItem[];
  meetings: MeetingSummary | null;
}

interface Piece {
  event: CalendarEvent;
  order: number;
  startCol: number;
  endCol: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
  either: boolean;
  span: boolean;
  slot: number;
}

/** Events that touch any day from `from` through `to`. */
function overlapping(events: CalendarEvent[], from: string, to: string) {
  return events.filter((e) => e.date <= to && lastDay(e) >= from);
}

function plural(title: string) {
  return /s$/i.test(title) ? title : `${title}s`;
}

function layoutWeek(events: CalendarEvent[], week: string[], month: string, maxSlots: number): WeekLayout {
  const { first, last } = monthBounds(month);
  const days: GridDay[] = week.map((date) => ({
    date,
    day: ymd(date).d,
    inMonth: date >= first && date <= last,
    noMeeting: false,
  }));
  const col = (date: string) => week.indexOf(date);
  const shown = (date: string) => date >= first && date <= last && col(date) >= 0;

  const pieces: Piece[] = [];
  events.forEach((event, order) => {
    const end = lastDay(event);
    if (event.endDate && !event.eitherDay) {
      // A trip: one bar across the days it covers in this week of this month.
      const visible = week.filter((d) => d >= event.date && d <= end && shown(d));
      if (visible.length === 0) return;
      const from = visible[0];
      const to = visible[visible.length - 1];
      pieces.push({
        event,
        order,
        startCol: col(from),
        endCol: col(to),
        continuesBefore: event.date < from,
        continuesAfter: end > to,
        either: false,
        span: true,
        slot: -1,
      });
      return;
    }
    // A single day, or each of a "Sat or Sun" pair.
    for (const date of event.eitherDay && event.endDate ? [event.date, event.endDate] : [event.date]) {
      if (!shown(date)) continue;
      pieces.push({
        event,
        order,
        startCol: col(date),
        endCol: col(date),
        continuesBefore: false,
        continuesAfter: false,
        either: !!event.eitherDay,
        span: false,
        slot: -1,
      });
    }
  });

  for (const p of pieces) if (p.event.noMeeting) for (let c = p.startCol; c <= p.endCol; c++) days[c].noMeeting = true;

  // Trips first so their bars line up across the week, longest first; then each
  // day's own events in the order the page lists them (the meeting above a pack night).
  pieces.sort((a, b) =>
    a.span !== b.span
      ? a.span ? -1 : 1
      : a.span && a.startCol !== b.startCol
        ? a.startCol - b.startCol
        : a.span && a.endCol - a.startCol !== b.endCol - b.startCol
          ? b.endCol - b.startCol - (a.endCol - a.startCol)
          : a.order - b.order,
  );
  const used: Set<number>[] = week.map(() => new Set());
  for (const p of pieces) {
    let slot = 0;
    const free = (s: number) => {
      for (let c = p.startCol; c <= p.endCol; c++) if (used[c].has(s)) return false;
      return true;
    };
    while (!free(slot)) slot++;
    p.slot = slot;
    for (let c = p.startCol; c <= p.endCol; c++) used[c].add(slot);
  }

  // A column with more events than room keeps its last row for "+N more".
  const limit = used.map((slots) => (slots.size && Math.max(...slots) + 1 > maxSlots ? maxSlots - 1 : maxSlots));
  const more = used.map((slots, c) => [...slots].filter((s) => s >= limit[c]).length);

  const chips: PlacedChip[] = [];
  for (const p of pieces) {
    // Split the bar wherever a column has hidden this row.
    let runStart = -1;
    for (let c = p.startCol; c <= p.endCol + 1; c++) {
      const visible = c <= p.endCol && p.slot < limit[c];
      if (visible && runStart < 0) runStart = c;
      if (!visible && runStart >= 0) {
        chips.push({
          text: chipText(p.event),
          kind: chipKind(p.event),
          important: !!p.event.important,
          either: p.either,
          slot: p.slot,
          startCol: runStart,
          endCol: c - 1,
          continuesBefore: runStart > p.startCol || p.continuesBefore,
          continuesAfter: c - 1 < p.endCol || p.continuesAfter,
        });
        runStart = -1;
      }
    }
  }
  chips.sort((a, b) => a.slot - b.slot || a.startCol - b.startCol);
  return { days, chips, more };
}

function detailItem(e: CalendarEvent): DetailItem {
  const tags: string[] = [];
  if (e.volunteer) tags.push(AUDIENCE_LABELS[e.volunteer]);
  if (e.noMeeting) tags.push("No Meeting");
  if (e.tbd) tags.push("Date TBD");
  return {
    when: exportWhen(e),
    title: exportText(e.title) || "Event",
    detail: exportText(e.detail),
    kind: chipKind(e),
    tags,
    important: !!e.important,
  };
}

/**
 * One month's page: the grid (with at most `maxSlots` event rows per day
 * cell), the details list of every event that touches the month — the full
 * title and detail that a cell may have had to cut short — and the month's
 * regular meetings summed up in one line rather than listed one by one.
 */
export function layoutMonth(cal: Pick<ExportCalendar, "events">, month: string, maxSlots: number): MonthLayout {
  const { first, last } = monthBounds(month);
  const inMonth = overlapping(cal.events, first, last);
  const weeks = monthWeeks(month).map((week) => layoutWeek(inMonth, week, month, Math.max(1, maxSlots)));

  const meetings = inMonth.filter((e) => e.category === "meeting");
  const summary: MeetingSummary | null = meetings.length
    ? {
        title: plural(exportText(meetings[0].title) || "Scout Meeting"),
        when: `${WEEKDAYS[ymd(meetings[0].date).dow]}days: ${monthShort(month)} ${meetings.map((m) => ymd(m.date).d).join(", ")}`,
        detail: exportText(meetings[0].detail),
      }
    : null;

  return {
    month,
    title: monthTitle(month),
    weeks,
    details: inMonth.filter((e) => e.category !== "meeting").map(detailItem),
    meetings: summary,
  };
}

// ---------------------------------------------------------------------------
// The whole year
// ---------------------------------------------------------------------------

export interface YearOverview {
  glance: { category: GlanceGroup["category"]; title: string; items: { label: string; when: string }[] }[];
  /** "Sep 13", one per Scout Sunday. */
  scoutSundays: string[];
  /** "Nov 27 · Thanksgiving", one per No Meeting night. */
  noMeetings: string[];
  /** "Every Friday · 7:30 – 9:30 PM · Sep 11 – Jun 11"; null without a meeting rule. */
  meetings: MeetingSummary | null;
}

/** The full calendar's opening page, in the spirit of the page's Year at a Glance box. */
export function yearOverview(cal: Pick<ExportCalendar, "events" | "glance">): YearOverview {
  const meetings = cal.events.filter((e) => e.category === "meeting");
  return {
    glance: cal.glance.map((g) => ({
      category: g.category,
      title: g.title,
      items: g.items.map((i) => ({ label: exportText(i.label) || "Event", when: exportText(i.when) })),
    })),
    scoutSundays: cal.events.filter((e) => e.category === "scout-sunday").map((e) => shortDate(e.date)),
    noMeetings: cal.events
      .filter((e) => e.noMeeting)
      .map((e) => {
        const reason = exportText(noMeetingReason(e.title));
        const when = e.endDate && !e.eitherDay ? `${shortDate(e.date)}–${shortDate(e.endDate)}` : shortDate(e.date);
        return reason ? `${when} · ${reason}` : when;
      }),
    meetings: meetings.length
      ? {
          title: plural(exportText(meetings[0].title) || "Scout Meeting"),
          when: `Every ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][ymd(meetings[0].date).dow]}, ${shortDate(meetings[0].date)} – ${shortDate(meetings[meetings.length - 1].date)}`,
          detail: exportText(meetings[0].detail),
        }
      : null,
  };
}

/** Which color a day takes on the year poster when several events share it. */
const MINI_PRIORITY: ChipKind[] = ["camping", "pack-night", "one-day", "fundraiser", "scout-sunday", "no-meeting", "general"];

export interface MiniDay {
  /** Day of the month, or null for the blank days before the 1st and after the last. */
  day: number | null;
  /** The day's color, or null for a plain day. */
  kind: ChipKind | null;
  /** A regular meeting night (marked even when another color fills the day). */
  meeting: boolean;
  important: boolean;
}

/** One small month for the year poster: each day colored by what happens on it. */
export function miniMonth(cal: Pick<ExportCalendar, "events">, month: string): { title: string; weeks: MiniDay[][] } {
  const { first, last } = monthBounds(month);
  const inMonth = overlapping(cal.events, first, last);
  const weeks = monthWeeks(month).map((week) =>
    week.map((date): MiniDay => {
      if (date < first || date > last) return { day: null, kind: null, meeting: false, important: false };
      const on = inMonth.filter((e) =>
        e.endDate && e.eitherDay ? e.date === date || e.endDate === date : e.date <= date && date <= lastDay(e),
      );
      const kinds = new Set(on.filter((e) => e.category !== "meeting").map(chipKind));
      return {
        day: ymd(date).d,
        kind: MINI_PRIORITY.find((k) => kinds.has(k)) ?? null,
        meeting: on.some((e) => e.category === "meeting"),
        important: on.some((e) => e.important),
      };
    }),
  );
  return { title: monthTitle(month), weeks };
}
