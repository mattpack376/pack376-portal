import "server-only";
import { prisma } from "@/lib/prisma";
import { scoutingYearForDate, ensureMeetingDates, formatMeetingDate } from "@/lib/attendanceSchedule";
import { getScoutDuesDetail } from "@/lib/duesData";
import {
  getScoutEventBalances,
  getGuestGroupBalances,
  getOpenEventsForSelfRegistration,
  getUpcomingVisibleEvents,
} from "@/lib/eventsData";

function todayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function getParentDashboardData(scoutIds: string[], userId: string) {
  const today = todayUtc();

  // Best-effort — meeting dates for the current scouting year may not have
  // been generated yet if no one has opened an attendance page this year.
  try {
    await ensureMeetingDates(scoutingYearForDate(today));
  } catch {
    // Non-fatal: "next meeting" below just comes back empty.
  }

  const [scouts, nextMeeting, announcements, deadlines, volunteerNeeds] = await Promise.all([
    prisma.scout.findMany({
      where: { id: { in: scoutIds } },
      include: { den: true, photoConsent: true },
      orderBy: [{ firstName: "asc" }],
    }),
    prisma.meetingDate.findFirst({
      where: { date: { gte: today }, status: "SCHEDULED" },
      orderBy: { date: "asc" },
    }),
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

  return {
    scouts: scouts.map((scout, i) => ({
      id: scout.id,
      firstName: scout.firstName,
      lastName: scout.lastName,
      den: scout.den,
      photoConsent: scout.photoConsent
        ? {
            needsSignature: !scout.photoConsent.signedAt,
            // The live token, same one the leader roster shows. Whether the
            // form has been signed or not, it's good for exactly one
            // submission and rotates on submit, so handing it to the parent
            // whose scout it is lets them revise their answers without a
            // leader having to issue a fresh link.
            token: scout.photoConsent.token,
            facebook: scout.photoConsent.facebook,
            website: scout.photoConsent.website,
            fliers: scout.photoConsent.fliers,
            signedByName: scout.photoConsent.signedByName,
            signedRelationship: scout.photoConsent.signedRelationship,
            signedDate: scout.photoConsent.signedDate,
          }
        : null,
      dues: duesByScout[i],
    })),
    nextMeeting: nextMeeting ? { formatted: formatMeetingDate(nextMeeting.date) } : null,
    announcements,
    deadlines,
    volunteerNeeds,
    eventBalances,
    guestGroupBalances,
    openEvents,
    upcomingEvents,
  };
}
