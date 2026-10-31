import "server-only";
import { prisma } from "@/lib/prisma";
import { ensureMeetingDates, meetingDatesForYear, scoutingYearForDate } from "@/lib/attendanceSchedule";
import { RANK_ORDER } from "@/lib/rankConfig";
import { auditDate } from "@/lib/audit";
import { canEditMeetingAttendance } from "@/lib/attendanceLock";
import { getAttendanceLockRule } from "@/lib/attendanceLockSetting";
import type { Rank } from "@/generated/prisma/enums";

/** Whether attendance can be marked for this meeting — false for a No Meeting day or an id that doesn't exist. */
export async function meetingIsSchedulable(meetingDateId: string) {
  const meeting = await prisma.meetingDate.findUnique({ where: { id: meetingDateId }, select: { status: true } });
  return !!meeting && meeting.status === "SCHEDULED";
}

/**
 * True when this meeting's attendance has locked (at the master admin's saved
 * lock time — see attendanceLock.ts) and the login isn't an Admin. Every write path asks this, so
 * the lock can't be sidestepped by an open page or a hand-built request. An id
 * that doesn't exist reads as not locked; the callers' other checks reject it.
 */
export async function attendanceLockedFor(role: string, meetingDateId: string) {
  const meeting = await prisma.meetingDate.findUnique({ where: { id: meetingDateId }, select: { date: true } });
  if (!meeting) return false;
  return !canEditMeetingAttendance(role, meeting.date, await getAttendanceLockRule());
}

/** The meeting's date as audit text; falls back to the id if the row vanished mid-request. */
export async function meetingLabel(meetingDateId: string) {
  const meeting = await prisma.meetingDate.findUnique({ where: { id: meetingDateId }, select: { date: true } });
  return meeting ? auditDate(meeting.date) : meetingDateId;
}

/**
 * Which scouts a meeting lists: everyone active now, plus anyone since made
 * inactive who was already marked for that meeting — so switching a scout off
 * never rewrites the meetings they were at. Same rule as the Leaders &
 * Committee list (adultLeaderAttendanceData.ts), shared by the meeting pages
 * and the per-meeting counts so they always agree on who's on a given night.
 */
export function scoutsListedForMeeting(meetingDateId: string) {
  return { OR: [{ active: true }, { attendances: { some: { meetingDateId } } }] };
}

export type MeetingListItem = {
  id: string;
  date: Date;
  status: "SCHEDULED" | "NO_MEETING";
  presentCount: number;
  /** MeetingDate.label — what the night is, e.g. "Camp Conron". */
  eventLabel: string | null;
};

/** A scout meeting row plus how many scouts that night lists (the "/N" in "7/9 present"). */
export type ScoutMeetingListItem = MeetingListItem & { listedCount: number };

function presentCountsByDate(attendances: { meetingDateId: string; present: boolean }[]) {
  const counts = new Map<string, number>();
  for (const a of attendances) {
    if (a.present) counts.set(a.meetingDateId, (counts.get(a.meetingDateId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Per meeting: the active scouts plus any inactive scout marked that night
 * (see scoutsListedForMeeting). `attendances` must cover every scout in
 * `scouts`, active or not, for the dates being counted.
 */
function listedCountsByDate(
  activeCount: number,
  inactiveScoutIds: Set<string>,
  attendances: { scoutId: string; meetingDateId: string }[]
) {
  const counts = new Map<string, number>();
  for (const a of attendances) {
    if (inactiveScoutIds.has(a.scoutId)) counts.set(a.meetingDateId, (counts.get(a.meetingDateId) ?? 0) + 1);
  }
  return (meetingDateId: string) => activeCount + (counts.get(meetingDateId) ?? 0);
}

export async function getDenAttendanceOverview(denId: string) {
  const den = await prisma.den.findUnique({ where: { id: denId } });
  if (!den) return null;

  await ensureMeetingDates(den.scoutingYear);

  const [dates, scouts] = await Promise.all([
    meetingDatesForYear(den.scoutingYear),
    prisma.scout.findMany({ where: { denId }, select: { id: true, active: true } }),
  ]);

  const activeCount = scouts.filter((s) => s.active).length;
  const inactiveIds = new Set(scouts.filter((s) => !s.active).map((s) => s.id));
  const attendances = await prisma.attendance.findMany({
    where: { scoutId: { in: scouts.map((s) => s.id) }, meetingDateId: { in: dates.map((d) => d.id) } },
  });
  const counts = presentCountsByDate(attendances);
  const listedFor = listedCountsByDate(activeCount, inactiveIds, attendances);

  const items: ScoutMeetingListItem[] = dates.map((d) => ({
    id: d.id,
    date: d.date,
    status: d.status,
    presentCount: counts.get(d.id) ?? 0,
    eventLabel: d.label,
    listedCount: listedFor(d.id),
  }));

  return { den, totalScouts: activeCount, dates: items };
}

export async function getMeetingDetailForDen(denId: string, meetingDateId: string) {
  const [den, meeting] = await Promise.all([
    prisma.den.findUnique({ where: { id: denId } }),
    prisma.meetingDate.findUnique({ where: { id: meetingDateId } }),
  ]);
  if (!den || !meeting) return null;

  const scouts = await prisma.scout.findMany({
    where: { denId, ...scoutsListedForMeeting(meetingDateId) },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: {
      attendances: {
        where: { meetingDateId },
        include: { updatedByUser: { select: { username: true } } },
      },
    },
  });

  return {
    den,
    meeting,
    eventLabel: meeting.label,
    scouts: scouts.map((s) => ({
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      active: s.active,
      present: s.attendances[0]?.present ?? null,
      updatedAt: s.attendances[0]?.updatedAt ?? null,
      updatedByUsername: s.attendances[0]?.updatedByUser?.username ?? null,
    })),
  };
}

export async function getAdminScoutingYears() {
  const dens = await prisma.den.findMany({ select: { scoutingYear: true }, distinct: ["scoutingYear"] });
  return dens.map((d) => d.scoutingYear).sort().reverse();
}

export async function getAdminMeetingOverview(scoutingYear: string) {
  await ensureMeetingDates(scoutingYear);

  const [dates, dens] = await Promise.all([
    meetingDatesForYear(scoutingYear),
    prisma.den.findMany({ where: { scoutingYear }, include: { scouts: { select: { id: true, active: true } } } }),
  ]);

  const allScouts = dens.flatMap((d) => d.scouts);
  const activeCount = allScouts.filter((s) => s.active).length;
  const inactiveIds = new Set(allScouts.filter((s) => !s.active).map((s) => s.id));
  const attendances = await prisma.attendance.findMany({
    where: { scoutId: { in: allScouts.map((s) => s.id) }, meetingDateId: { in: dates.map((d) => d.id) } },
  });
  const counts = presentCountsByDate(attendances);
  const listedFor = listedCountsByDate(activeCount, inactiveIds, attendances);

  const items: ScoutMeetingListItem[] = dates.map((d) => ({
    id: d.id,
    date: d.date,
    status: d.status,
    presentCount: counts.get(d.id) ?? 0,
    eventLabel: d.label,
    listedCount: listedFor(d.id),
  }));

  return { scoutingYear, totalScouts: activeCount, dates: items };
}

export async function getMeetingDetailForAdmin(meetingDateId: string) {
  const meeting = await prisma.meetingDate.findUnique({ where: { id: meetingDateId } });
  if (!meeting) return null;
  const scoutingYear = scoutingYearForDate(meeting.date);

  const dens = await prisma.den.findMany({
    where: { scoutingYear },
    include: {
      scouts: {
        where: scoutsListedForMeeting(meetingDateId),
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        include: {
          attendances: {
            where: { meetingDateId },
            include: { updatedByUser: { select: { username: true } } },
          },
        },
      },
    },
  });
  dens.sort((a, b) => RANK_ORDER.indexOf(a.rank as Rank) - RANK_ORDER.indexOf(b.rank as Rank));

  return {
    meeting,
    eventLabel: meeting.label,
    scoutingYear,
    dens: dens.map((den) => ({
      id: den.id,
      rank: den.rank,
      scoutingYear: den.scoutingYear,
      label: den.label,
      scouts: den.scouts.map((s) => ({
        id: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        active: s.active,
        present: s.attendances[0]?.present ?? null,
        updatedAt: s.attendances[0]?.updatedAt ?? null,
        updatedByUsername: s.attendances[0]?.updatedByUser?.username ?? null,
      })),
    })),
  };
}
