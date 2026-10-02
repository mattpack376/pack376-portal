/*
 * The 2026–2027 Calendar of Events, transcribed from the pack's Google Doc
 * (the one calendar.pack376nyc.org points at). Dates are plain YYYY-MM-DD
 * strings and never go through a Date in local time — see dateOnly.ts for why
 * a date-only value that round-trips through the browser's time zone drifts a
 * day. The weekday and month names are derived here from the UTC calendar.
 *
 * Categories mirror the doc's color coding:
 *   camping     red    — campouts
 *   pack-night  gold   — pack-wide nights (parties, derby, carnival, graduation)
 *   one-day     green  — one-day outings and events
 *   fundraiser  cream  — fundraisers (red bold text in the doc)
 *   general     white  — everything the doc left uncolored (Scout Sunday, etc.)
 * The italic rows in the doc are `volunteer` setup/planning nights and the
 * bold "No Meeting" rows are `noMeeting`.
 */

export type CalendarCategory = "camping" | "pack-night" | "one-day" | "fundraiser" | "general";

export interface CalendarEvent {
  /** First (or only) day, YYYY-MM-DD. */
  date: string;
  /** Last day of a multi-day event, inclusive. */
  endDate?: string;
  /** Set when the doc gives two candidate days ("Sat or Sun") rather than a span. */
  eitherDay?: boolean;
  title: string;
  /** Time, place, or a short note shown under the title. */
  detail?: string;
  category: CalendarCategory;
  /** Setup/planning nights for adults — not scheduled activities for scouts. */
  volunteer?: "leaders" | "all-hands";
  noMeeting?: boolean;
  tbd?: boolean;
  /** A note important enough to bold, like "first meeting, full uniform". */
  important?: boolean;
  link?: { href: string; label: string };
}

export const CONRON_URL = "https://conron.pack376nyc.org";

export const CALENDAR_EVENTS: CalendarEvent[] = [
  // ---- August 2026
  {
    date: "2026-08-01",
    title: "Boy Scout Eagle Service Project",
    detail: "Cubs encouraged to join for service hours credit",
    category: "general",
  },
  {
    date: "2026-08-04",
    title: "National Night Out",
    detail: "4:00 – 7:00 PM at NYPD 61 PCT",
    category: "general",
  },
  {
    date: "2026-08-08",
    title: "Kayaking",
    detail: "Floyd Bennett Field · 10:00 AM – 1:00 PM",
    category: "general",
  },
  {
    date: "2026-08-15",
    title: "Coney Island Sand Sculpting Competition",
    detail: "11:00 AM – 4:00 PM",
    category: "general",
  },
  {
    date: "2026-08-17",
    title: "Committee Meeting",
    detail: "7:30 PM",
    category: "general",
    volunteer: "leaders",
  },
  {
    date: "2026-08-24",
    title: "Leaders Meeting",
    detail: "7:30 PM",
    category: "general",
    volunteer: "leaders",
  },

  // ---- September 2026
  { date: "2026-09-04", title: "No Meeting", category: "general", noMeeting: true },
  {
    date: "2026-09-11",
    title: "Scout Registration Night",
    detail: "Parents only",
    category: "general",
  },
  {
    date: "2026-09-18",
    title: "Scout Registration Night",
    detail: "Parents only · Cubmaster meeting with parents and families",
    category: "general",
  },
  {
    date: "2026-09-25",
    title: "First Scout Meeting",
    detail: "All returning scouts in full uniform",
    category: "general",
    important: true,
  },

  // ---- October 2026
  { date: "2026-10-04", title: "Scout Sunday", detail: "10 AM Mass", category: "general" },
  {
    date: "2026-10-08",
    title: "Prepare for Camping Trip",
    category: "general",
    volunteer: "all-hands",
  },
  {
    date: "2026-10-09",
    endDate: "2026-10-12",
    title: "Camp Conron Weekend",
    detail: "Columbus Day Weekend",
    category: "camping",
    link: { href: CONRON_URL, label: "Trip details" },
  },
  { date: "2026-10-12", title: "Columbus Day", detail: "Return from camp", category: "general" },
  {
    date: "2026-10-29",
    title: "Setup for Pack Halloween Party",
    detail: "6:00 PM",
    category: "general",
    volunteer: "leaders",
  },
  { date: "2026-10-30", title: "Pack Halloween Party", category: "pack-night" },

  // ---- November 2026
  { date: "2026-11-01", title: "Scout Sunday", detail: "10 AM Mass", category: "general" },
  {
    date: "2026-11-07",
    endDate: "2026-11-08",
    eitherDay: true,
    title: "Parish Anniversary (Chartering Organization)",
    detail: "All scouts present",
    category: "one-day",
  },
  { date: "2026-11-20", title: "Pie Night & Bring-a-Friend Night", category: "one-day" },
  {
    date: "2026-11-22",
    title: "OLG Christmas Fair — Pack Fundraiser",
    category: "fundraiser",
    volunteer: "all-hands",
  },
  { date: "2026-11-27", title: "Black Friday — No Meeting", category: "general", noMeeting: true },

  // ---- December 2026
  {
    date: "2026-12-17",
    title: "Setup for Pack Christmas Party",
    detail: "6:00 PM",
    category: "general",
    volunteer: "all-hands",
  },
  { date: "2026-12-18", title: "Christmas Pack Night", category: "pack-night" },
  { date: "2026-12-20", title: "Scout Sunday", detail: "10 AM Mass", category: "general" },
  { date: "2026-12-25", title: "Christmas Day — No Meeting", category: "general", noMeeting: true },

  // ---- January 2027
  { date: "2027-01-01", title: "New Year's Day — No Meeting", category: "general", noMeeting: true },
  { date: "2027-01-10", title: "Scout Sunday", detail: "10 AM Mass", category: "general" },
  { date: "2027-01-31", title: "Klondike Derby", detail: "Coney Island", category: "one-day" },

  // ---- March 2027 (the doc has no February section)
  {
    date: "2027-03-04",
    title: "Pinewood Derby Setup",
    detail: "6:00 PM",
    category: "general",
    volunteer: "all-hands",
  },
  {
    date: "2027-03-05",
    endDate: "2027-03-06",
    title: "Pack 376 Pinewood Derby + Overnight Lockup",
    category: "pack-night",
  },
  {
    date: "2027-03-06",
    title: "Kings Plaza Pinewood Derby Competition",
    detail: "Pack participation TBD",
    category: "one-day",
    tbd: true,
  },
  { date: "2027-03-14", title: "Scout Sunday · OLG Easter Fair", category: "general" },
  {
    date: "2027-03-14",
    title: "Easter Fair Bake Sale Fundraiser",
    category: "fundraiser",
    volunteer: "all-hands",
  },
  {
    date: "2027-03-18",
    title: "Pull Camping Gear",
    detail: "6:00 PM",
    category: "general",
    volunteer: "all-hands",
  },
  { date: "2027-03-19", endDate: "2027-03-21", title: "Camp Pouch Weekend", category: "camping" },
  { date: "2027-03-26", title: "Good Friday — No Meeting", category: "general", noMeeting: true },
  {
    date: "2027-03-28",
    title: "Easter Sunday Bake Sale for Easter Mass",
    category: "fundraiser",
    volunteer: "all-hands",
  },

  // ---- April 2027
  { date: "2027-04-04", title: "Scout Sunday", detail: "10 AM Mass", category: "general" },

  // ---- May 2027
  {
    date: "2027-05-06",
    title: "Pull Camping Gear",
    detail: "6:00 PM",
    category: "general",
    volunteer: "all-hands",
  },
  {
    date: "2027-05-07",
    endDate: "2027-05-09",
    title: "Camp Alpine Campout + Cub Day Activities",
    category: "camping",
  },
  { date: "2027-05-08", title: "Cub Day @ Alpine Activities", category: "one-day" },
  { date: "2027-05-23", title: "Scout Sunday", detail: "10 AM Mass", category: "general" },
  {
    date: "2027-05-27",
    title: "Pull Camping Gear",
    detail: "6:00 PM",
    category: "general",
    volunteer: "all-hands",
  },
  {
    date: "2027-05-28",
    endDate: "2027-05-31",
    title: "Memorial Day Camping Trip with Troop 376",
    category: "camping",
  },

  // ---- June 2027
  {
    date: "2027-06-03",
    title: "Carnival Setup",
    detail: "5:00 PM",
    category: "general",
    volunteer: "all-hands",
  },
  {
    date: "2027-06-04",
    title: "Carnival Night",
    category: "pack-night",
    volunteer: "all-hands",
  },
  { date: "2027-06-06", title: "Scout Sunday", detail: "10 AM Mass", category: "general" },
  {
    date: "2027-06-17",
    title: "Graduation Setup",
    detail: "6:00 PM",
    category: "general",
    volunteer: "all-hands",
  },
  {
    date: "2027-06-18",
    title: "Graduation Night",
    detail: "Crossing-Over Ceremony",
    category: "pack-night",
  },
];

/** The doc's "Year at a Glance — Don't Miss These!" box. Kept by hand, not derived: it's a curated subset, and it includes the Cyclones outing, which has no date yet. */
export const YEAR_AT_A_GLANCE: {
  category: Exclude<CalendarCategory, "general" | "fundraiser">;
  title: string;
  items: { label: string; when: string; month?: string }[];
}[] = [
  {
    category: "camping",
    title: "Camping Trips",
    items: [
      { label: "Camp Conron Weekend", when: "Oct 9–12", month: "2026-10" },
      { label: "Camp Pouch Weekend", when: "Mar 19–21", month: "2027-03" },
      { label: "Camp Alpine + Cub Day Weekend", when: "May 7–9", month: "2027-05" },
      { label: "Memorial Day Camping w/ Troop 376", when: "May 28–31", month: "2027-05" },
    ],
  },
  {
    category: "pack-night",
    title: "Pack Night Events",
    items: [
      { label: "Halloween Pack Night", when: "Oct 30", month: "2026-10" },
      { label: "Christmas Pack Night", when: "Dec 18", month: "2026-12" },
      { label: "Pinewood Derby & Lockup Overnighter", when: "Mar 5–6", month: "2027-03" },
      { label: "Carnival Night", when: "Jun 4", month: "2027-06" },
      { label: "Graduation Night", when: "Jun 18", month: "2027-06" },
    ],
  },
  {
    category: "one-day",
    title: "One Day Events",
    items: [
      { label: "Bring a Pie & Bring a Friend Night", when: "Nov 20", month: "2026-11" },
      { label: "OLG Parish Anniversary Celebration", when: "Early Nov", month: "2026-11" },
      { label: "Klondike Derby", when: "Jan 31", month: "2027-01" },
      { label: "Cub Day @ Alpine", when: "May 8", month: "2027-05" },
      { label: "Brooklyn Cyclones Outing", when: "TBD" },
    ],
  },
];

/** Scouting-year months shown on the page, so a month with no events (February) still gets a heading. */
export const CALENDAR_MONTHS: string[] = [
  "2026-08", "2026-09", "2026-10", "2026-11", "2026-12",
  "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06",
];

const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parts(iso: string): { y: number; m: number; d: number; dow: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** "2026-10" -> "October 2026". */
export function monthTitle(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return `${MONTH_LONG[m - 1]} ${y}`;
}

/** "2026-10" -> "Oct". */
export function monthShort(monthKey: string): string {
  return MONTH_LONG[Number(monthKey.split("-")[1]) - 1].slice(0, 3);
}

/** The two lines of the calendar-leaf date badge: "Fri–Mon" over "9–12". */
export function badgeParts(e: CalendarEvent): { top: string; bottom: string } {
  const start = parts(e.date);
  if (!e.endDate) return { top: DOW_SHORT[start.dow], bottom: String(start.d) };
  const end = parts(e.endDate);
  if (e.eitherDay) return { top: `${DOW_SHORT[start.dow]}/${DOW_SHORT[end.dow]}`, bottom: `${start.d}/${end.d}` };
  return { top: `${DOW_SHORT[start.dow]}–${DOW_SHORT[end.dow]}`, bottom: `${start.d}–${end.d}` };
}

/** "Friday, October 9 – Monday, October 12" — for screen readers and the Next Up card. */
export function longDateLabel(e: CalendarEvent): string {
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

export function lastDay(e: CalendarEvent): string {
  return e.endDate ?? e.date;
}
