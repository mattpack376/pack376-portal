/*
 * What the Parent Dashboard's "Upcoming Events" list shows: the pack's
 * registration events (the Event table — fees, flyers, sign-ups) merged with
 * what's on the public calendar. Pure, so the server loader and a quick script
 * can both use it; the calendar side is CalendarEvent from calendarData.ts.
 */

import {
  badgeParts,
  dateRangeLabel,
  isUpcoming,
  lastDay,
  type CalendarCategory,
  type CalendarEvent,
} from "@/lib/calendarData";
import type { DeadlineCategory } from "@/generated/prisma/enums";

/** One row of the merged list: a registration event or a calendar event. */
export type UpcomingItem =
  | {
      kind: "event";
      id: string;
      title: string;
      category: DeadlineCategory;
      eventDate: Date;
      description: string | null;
      flyerUrl: string | null;
    }
  | { kind: "calendar"; key: string; event: CalendarEvent };

/**
 * The calendar categories a family cares about. General rows are left out:
 * setup and prep nights, holidays, registration notes — plus "No Meeting"
 * entries, which the Next Meeting card already reports. The regular Friday
 * meeting isn't stored as an event, so it never appears here.
 *
 * The "All Hands on Deck" flag is deliberately NOT a filter: it marks setup
 * nights, but also real family events (the Christmas Fair, Carnival Night).
 */
const FAMILY_CATEGORIES: CalendarCategory[] = ["camping", "pack-night", "one-day", "fundraiser", "scout-sunday"];

/** How many calendar-only events to add. Registration events are never cut. */
export const CALENDAR_ITEM_LIMIT = 6;

// Words too generic to say two events are the same one.
const GENERIC_WORDS = new Set(["pack", "scout", "scouts", "night", "weekend", "trip", "event", "camp", "with", "from"]);

function significantWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w)),
  );
}

/** A registration event and a calendar event are the same thing when it lands on that event's days and shares a name word. */
function isSameEvent(
  registration: { title: string; date: string; camping: boolean },
  event: CalendarEvent,
): boolean {
  if (registration.date < event.date || registration.date > lastDay(event)) return false;
  // Two camping trips overlapping on the same days are the one trip, however they're titled.
  if (registration.camping && event.category === "camping") return true;
  const theirs = significantWords(event.title);
  for (const word of significantWords(registration.title)) if (theirs.has(word)) return true;
  return false;
}

/**
 * The calendar events to add to the list: still ahead, a family-facing
 * category, and not already covered by a registration event (the registration
 * event wins — it carries the flyer and the sign-up). Earliest first, capped.
 */
export function parentCalendarEvents(
  events: CalendarEvent[],
  registrations: { title: string; date: string; camping: boolean }[],
  today: string,
  limit: number = CALENDAR_ITEM_LIMIT,
): CalendarEvent[] {
  return events
    .filter(
      (e) =>
        FAMILY_CATEGORIES.includes(e.category) &&
        !e.noMeeting &&
        isUpcoming(e, today) &&
        !registrations.some((r) => isSameEvent(r, e)),
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit);
}

/** Both kinds in one date-ordered list; on the same day the registration event comes first. */
export function mergeUpcoming(registrationItems: UpcomingItem[], calendarItems: UpcomingItem[]): UpcomingItem[] {
  const day = (item: UpcomingItem) =>
    item.kind === "event" ? item.eventDate.toISOString().slice(0, 10) : item.event.date;
  return [...registrationItems, ...calendarItems].sort((a, b) => day(a).localeCompare(day(b)));
}

/**
 * "Sun, Oct 4, 2026", "Fri–Mon, Oct 9–12, 2026", "Sat/Sun, Nov 7/8, 2026". The
 * year is always there so these read the same as the registration events
 * beside them ("Fri, Oct 30, 2026").
 */
export function calendarWhenLabel(event: CalendarEvent): string {
  const { top } = badgeParts(event);
  return `${top}, ${dateRangeLabel(event.date, event.endDate, event.eitherDay)}, ${(event.endDate ?? event.date).slice(0, 4)}`;
}
