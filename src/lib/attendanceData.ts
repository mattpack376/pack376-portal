import "server-only";
import { prisma } from "@/lib/prisma";
import { ensureMeetingDates, fridaysForScoutingYear, scoutingYearForDate } from "@/lib/attendanceSchedule";
import { RANK_ORDER } from "@/lib/rankConfig";
import type { Rank } from "@/generated/prisma/enums";

export type MeetingListItem = {
  id: string;
  date: Date;
  status: "SCHEDULED" | "NO_MEETING";
  presentCount: number;
};

function presentCountsByDate(attendances: { meetingDateId: string; present: boolean }[]) {
  const counts = new Map<string, number>();
  for (const a of attendances) {
    if (a.present) counts.set(a.meetingDateId, (counts.get(a.meetingDateId) ?? 0) + 1);
  }
  return counts;
}

export async function getDenAttendanceOverview(denId: string) {
  const den = await prisma.den.findUnique({ where: { id: denId } });
  if (!den) return null;

  await ensureMeetingDates(den.scoutingYear);
  const fridays = fridaysForScoutingYear(den.scoutingYear);

  const [dates, scouts] = await Promise.all([
    prisma.meetingDate.findMany({
      where: { date: { gte: fridays[0], lte: fridays[fridays.length - 1] } },
      orderBy: { date: "asc" },
    }),
    prisma.scout.findMany({ where: { denId }, select: { id: true } }),
  ]);

  const scoutIds = scouts.map((s) => s.id);
  const attendances = await prisma.attendance.findMany({
    where: { scoutId: { in: scoutIds }, meetingDateId: { in: dates.map((d) => d.id) } },
  });
  const counts = presentCountsByDate(attendances);

  const items: MeetingListItem[] = dates.map((d) => ({
    id: d.id,
    date: d.date,
    status: d.status,
    presentCount: counts.get(d.id) ?? 0,
  }));

  return { den, totalScouts: scoutIds.length, dates: items };
}

export async function getMeetingDetailForDen(denId: string, meetingDateId: string) {
  const [den, meeting] = await Promise.all([
    prisma.den.findUnique({ where: { id: denId } }),
    prisma.meetingDate.findUnique({ where: { id: meetingDateId } }),
  ]);
  if (!den || !meeting) return null;

  const scouts = await prisma.scout.findMany({
    where: { denId },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: { attendances: { where: { meetingDateId } } },
  });

  return {
    den,
    meeting,
    scouts: scouts.map((s) => ({
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      present: s.attendances[0]?.present ?? null,
    })),
  };
}

export async function getAdminScoutingYears() {
  const dens = await prisma.den.findMany({ select: { scoutingYear: true }, distinct: ["scoutingYear"] });
  return dens.map((d) => d.scoutingYear).sort().reverse();
}

export async function getAdminMeetingOverview(scoutingYear: string) {
  await ensureMeetingDates(scoutingYear);
  const fridays = fridaysForScoutingYear(scoutingYear);

  const [dates, dens] = await Promise.all([
    prisma.meetingDate.findMany({
      where: { date: { gte: fridays[0], lte: fridays[fridays.length - 1] } },
      orderBy: { date: "asc" },
    }),
    prisma.den.findMany({ where: { scoutingYear }, include: { scouts: { select: { id: true } } } }),
  ]);

  const allScoutIds = dens.flatMap((d) => d.scouts.map((s) => s.id));
  const attendances = await prisma.attendance.findMany({
    where: { scoutId: { in: allScoutIds }, meetingDateId: { in: dates.map((d) => d.id) } },
  });
  const counts = presentCountsByDate(attendances);

  const items: MeetingListItem[] = dates.map((d) => ({
    id: d.id,
    date: d.date,
    status: d.status,
    presentCount: counts.get(d.id) ?? 0,
  }));

  return { scoutingYear, totalScouts: allScoutIds.length, dates: items };
}

export async function getMeetingDetailForAdmin(meetingDateId: string) {
  const meeting = await prisma.meetingDate.findUnique({ where: { id: meetingDateId } });
  if (!meeting) return null;
  const scoutingYear = scoutingYearForDate(meeting.date);

  const dens = await prisma.den.findMany({
    where: { scoutingYear },
    include: {
      scouts: {
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        include: { attendances: { where: { meetingDateId } } },
      },
    },
  });
  dens.sort((a, b) => RANK_ORDER.indexOf(a.rank as Rank) - RANK_ORDER.indexOf(b.rank as Rank));

  return {
    meeting,
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
        present: s.attendances[0]?.present ?? null,
      })),
    })),
  };
}
