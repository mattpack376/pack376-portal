import "server-only";
import { prisma } from "@/lib/prisma";
import { ensureMeetingDates, fridaysForScoutingYear, scoutingYearForDate } from "@/lib/attendanceSchedule";
import { getAdminScoutingYears, type MeetingListItem } from "@/lib/attendanceData";
import { ADULT_LEADER_SECTIONS, ADULT_LEADER_SECTION_LABELS } from "@/lib/adultLeaderSections";
import { leaderContact } from "@/lib/adultLeaderContact";
import type { AdultLeaderSection } from "@/generated/prisma/enums";

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
    include: {
      _count: { select: { attendances: true } },
      // The login this person is linked to (if any) — their contact info lives
      // there; see adultLeaderContact.ts.
      user: { select: { id: true, username: true, displayName: true, email: true, phone: true } },
    },
  });
}

export type LeaderContactSection = {
  section: AdultLeaderSection;
  label: string;
  people: { id: string; name: string; positions: string[]; email: string | null; phone: string | null }[];
};

/**
 * The contact list behind every Leaders & Committee export (CSV, PDF and the
 * Printable View): everyone currently on the list, a section at a time in the
 * order the tracker shows them, with email and phone resolved through the
 * linked portal login when there is one (see adultLeaderContact.ts). People
 * taken off the list are left out. Empty sections are kept so a caller can say
 * "nobody yet" if it wants to; the exports drop them.
 */
export async function getLeaderContactList(): Promise<LeaderContactSection[]> {
  const leaders = await prisma.adultLeader.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { user: { select: { email: true, phone: true } } },
  });
  return ADULT_LEADER_SECTIONS.map((section) => ({
    section,
    label: ADULT_LEADER_SECTION_LABELS[section],
    people: leaders
      .filter((l) => l.section === section)
      .map((l) => ({ id: l.id, name: l.name, positions: l.positions, ...leaderContact(l) })),
  }));
}
