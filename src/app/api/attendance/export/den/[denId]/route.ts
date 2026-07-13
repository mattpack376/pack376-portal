import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAttendanceDenAccess } from "@/lib/authorize";
import { fridaysForScoutingYear } from "@/lib/attendanceSchedule";
import { buildAttendanceCsv, type AttendanceCsvRow } from "@/lib/attendanceCsv";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ denId: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse("Not authorized.", { status: 401 });

  const { denId } = await params;
  try {
    assertAttendanceDenAccess(session, denId);
  } catch {
    return new NextResponse("Not authorized.", { status: 403 });
  }

  const den = await prisma.den.findUnique({ where: { id: denId } });
  if (!den) return new NextResponse("Den not found.", { status: 404 });

  const fridays = fridaysForScoutingYear(den.scoutingYear);
  const dates = await prisma.meetingDate.findMany({
    where: { date: { gte: fridays[0], lte: fridays[fridays.length - 1] }, status: "SCHEDULED" },
    orderBy: { date: "asc" },
  });

  const scouts = await prisma.scout.findMany({
    where: { denId },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: { attendances: { where: { meetingDateId: { in: dates.map((d) => d.id) } } } },
  });

  const rows: AttendanceCsvRow[] = [];
  for (const scout of scouts) {
    const byDate = new Map(scout.attendances.map((a) => [a.meetingDateId, a.present]));
    for (const meeting of dates) {
      rows.push({
        scoutingYear: den.scoutingYear,
        rank: den.rank,
        label: den.label,
        firstName: scout.firstName,
        lastName: scout.lastName,
        date: meeting.date,
        present: byDate.get(meeting.id) ?? null,
      });
    }
  }

  const csv = buildAttendanceCsv(rows);
  const filename = `pack376-attendance-${den.rank.toLowerCase()}-${den.scoutingYear}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
