import "server-only";
import { prisma } from "@/lib/prisma";
import { ensureMeetingDates, fridaysForScoutingYear, scoutingYearForDate } from "@/lib/attendanceSchedule";
import { getAdminScoutingYears, type MeetingListItem } from "@/lib/attendanceData";
import { ADULT_LEADER_SECTIONS, ADULT_LEADER_SECTION_LABELS } from "@/lib/adultLeaderSections";

/**
 * Who a meeting lists: everyone active now, plus anyone since removed who was
 * already marked for that meeting — so taking someone off the list never
 * erases the record of the meetings they were at. Shared by the meeting page,
 * its "Mark All Present" button, and the per-meeting counts below, so all
 * three always agree on who's on a given meeting.
 */
export function leadersListedForMeeting(meetingDateId: string) {
  return { OR: [{ active: true }, { attendances: { some: { meetingDateId } } }] };
}

/**
 * Leaders aren't tied to a den, so unlike the scout calendar the current
 * season is always offered — even before any den exists for it yet.
 */
export async function getLeaderScoutingYears() {
  const years = new Set(await getAdminScoutingYears());
  years.add(scoutingYearForDate(new Date()));
  return [...years].sort().reverse();
}

export type LeaderMeetingListItem = MeetingListItem & { listedCount: number };

export async function getAdultLeaderMeetingOverview(scoutingYear: string) {
  await ensureMeetingDates(scoutingYear);
  const fridays = fridaysForScoutingYear(scoutingYear);

  const [dates, activeCount] = await Promise.all([
    prisma.meetingDate.findMany({
      where: { date: { gte: fridays[0], lte: fridays[fridays.length - 1] } },
      orderBy: { date: "asc" },
    }),
    prisma.adultLeader.count({ where: { active: true } }),
  ]);

  const attendances = await prisma.adultLeaderAttendance.findMany({
    where: { meetingDateId: { in: dates.map((d) => d.id) } },
    select: { meetingDateId: true, present: true, adultLeader: { select: { active: true } } },
  });

  const presentCounts = new Map<string, number>();
  const removedCounts = new Map<string, number>();
  for (const a of attendances) {
    if (a.present) presentCounts.set(a.meetingDateId, (presentCounts.get(a.meetingDateId) ?? 0) + 1);
    if (!a.adultLeader.active) removedCounts.set(a.meetingDateId, (removedCounts.get(a.meetingDateId) ?? 0) + 1);
  }

  const items: LeaderMeetingListItem[] = dates.map((d) => ({
    id: d.id,
    date: d.date,
    status: d.status,
    presentCount: presentCounts.get(d.id) ?? 0,
    listedCount: activeCount + (removedCounts.get(d.id) ?? 0),
  }));

  return { scoutingYear, activeCount, dates: items };
}

export async function getAdultLeaderMeetingDetail(meetingDateId: string) {
  const meeting = await prisma.meetingDate.findUnique({ where: { id: meetingDateId } });
  if (!meeting) return null;

  const leaders = await prisma.adultLeader.findMany({
    where: leadersListedForMeeting(meetingDateId),
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      attendances: {
        where: { meetingDateId },
        include: { updatedByUser: { select: { username: true } } },
      },
    },
  });

  return {
    meeting,
    scoutingYear: scoutingYearForDate(meeting.date),
    sections: ADULT_LEADER_SECTIONS.map((section) => ({
      section,
      label: ADULT_LEADER_SECTION_LABELS[section],
      leaders: leaders
        .filter((l) => l.section === section)
        .map((l) => ({
          id: l.id,
          name: l.name,
          positions: l.positions,
          active: l.active,
          present: l.attendances[0]?.present ?? null,
          updatedAt: l.attendances[0]?.updatedAt ?? null,
          updatedByUsername: l.attendances[0]?.updatedByUser?.username ?? null,
        })),
    })),
  };
}

/** Everyone on the list, active first — for the Manage List page. */
export async function getAdultLeaderRoster() {
  return prisma.adultLeader.findMany({
    orderBy: [{ active: "desc" }, { section: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { attendances: true } } },
  });
}
