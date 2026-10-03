import "server-only";
import { prisma } from "@/lib/prisma";
import { todayUtc, todayDateOnlyString } from "@/lib/dateOnly";
import { formatMeetingDate } from "@/lib/attendanceSchedule";
import { getCalendarForParents } from "@/lib/calendarEventsData";
import { dateRangeLabel, findNextMeeting } from "@/lib/calendarData";
import { mergeUpcoming, parentCalendarEvents, type UpcomingItem } from "@/lib/parentUpcoming";
import { getScoutDuesDetail } from "@/lib/duesData";
import {
  getScoutEventBalances,
  getGuestGroupBalances,
  getOpenEventsForSelfRegistration,
  getUpcomingVisibleEvents,
} from "@/lib/eventsData";

export async function getParentDashboardData(scoutIds: string[], userId: string) {
  const today = todayUtc();

  const [scouts, calendar, announcements, deadlines, volunteerNeeds] = await Promise.all([
    prisma.scout.findMany({
      where: { id: { in: scoutIds } },
      include: { den: true, photoConsent: true },
      orderBy: [{ firstName: "asc" }],
    }),
    // From the calendar, not the attendance dates: those include Scout Sundays
    // and the camping Friday, which aren't the regular meeting.
    getCalendarForParents(todayDateOnlyString()),
    prisma.announcement.findMany({
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: 6,
    }),
    prisma.deadline.findMany({
      where: { dueDate: { gte: today } },
      orderBy: { dueDate: "asc" },
      take: 6,
    }),
    prisma.volunteerNeed.findMany({
      where: { active: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const [duesByScout, eventBalances, guestGroupBalances, openEvents, upcomingEvents] = await Promise.all([
    Promise.all(scouts.map((s) => getScoutDuesDetail(s.id))),
    getScoutEventBalances(scoutIds),
    getGuestGroupBalances(userId),
    getOpenEventsForSelfRegistration(scoutIds, userId),
    getUpcomingVisibleEvents(),
  ]);

  const todayIso = todayDateOnlyString();
  const nextMeetingInfo = findNextMeeting(calendar.rule, calendar.events, todayIso, calendar.cancelled);

  // Registration events (flyers, sign-ups) and the calendar's family-facing
  // events in one list, with a calendar entry dropped when a registration event
  // is the same thing.
  const registrationItems: UpcomingItem[] = upcomingEvents.map((e) => ({ kind: "event" as const, ...e }));
  const calendarItems: UpcomingItem[] = parentCalendarEvents(
    calendar.events,
    upcomingEvents.map((e) => ({
      title: e.title,
      date: e.eventDate.toISOString().slice(0, 10),
      camping: e.category === "CAMPING",
    })),
    todayIso,
  ).map((event) => ({ kind: "calendar" as const, key: `${event.date}-${event.title}`, event }));

  return {
    scouts: scouts.map((scout, i) => ({
      id: scout.id,
      firstName: scout.firstName,
      lastName: scout.lastName,
      den: scout.den,
      // Once the form is signed the dashboard is read-only: it reports what
      // the family answered but deliberately withholds the live token, so a
      // change has to go through a leader issuing a fresh link and no answer
      // can quietly move without the pack knowing.
      photoConsent: scout.photoConsent
        ? scout.photoConsent.signedAt
          ? {
              needsSignature: false as const,
              facebook: scout.photoConsent.facebook,
              website: scout.photoConsent.website,
              fliers: scout.photoConsent.fliers,
              signedByName: scout.photoConsent.signedByName,
              signedRelationship: scout.photoConsent.signedRelationship,
              signedDate: scout.photoConsent.signedDate,
            }
          : { needsSignature: true as const, token: scout.photoConsent.token }
        : null,
      dues: duesByScout[i],
    })),
    nextMeeting: nextMeetingInfo
      ? {
          formatted: formatMeetingDate(new Date(`${nextMeetingInfo.date}T00:00:00.000Z`)),
          skipped: nextMeetingInfo.skipped.map((s) => ({
            when: dateRangeLabel(s.date, s.endDate),
            title: s.title,
            camping: s.camping,
          })),
        }
      : null,
    announcements,
    deadlines,
    volunteerNeeds,
    eventBalances,
    guestGroupBalances,
    openEvents,
    upcomingItems: mergeUpcoming(registrationItems, calendarItems),
  };
}
