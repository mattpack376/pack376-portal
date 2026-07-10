import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin } from "@/lib/authorize";
import { fridaysForScoutingYear } from "@/lib/attendanceSchedule";
import { buildAttendanceCsv, type AttendanceCsvRow } from "@/lib/attendanceCsv";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("Not authorized.", { status: 401 });
  try {
    assertAdmin(session);
  } catch {
    return new NextResponse("Not authorized.", { status: 403 });
  }

  const scoutingYear = request.nextUrl.searchParams.get("scoutingYear");
  if (!scoutingYear) return new NextResponse("Missing scoutingYear query param.", { status: 400 });

  const fridays = fridaysForScoutingYear(scoutingYear);
  const dates = await prisma.meetingDate.findMany({
    where: { date: { gte: fridays[0], lte: fridays[fridays.length - 1] }, status: "SCHEDULED" },
    orderBy: { date: "asc" },
  });

  const dens = await prisma.den.findMany({
    where: { scoutingYear },
    include: {
      scouts: {
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        include: { attendances: { where: { meetingDateId: { in: dates.map((d) => d.id) } } } },
      },
    },
  });

  const rows: AttendanceCsvRow[] = [];
  for (const den of dens) {
    for (const scout of den.scouts) {
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
  }

  const csv = buildAttendanceCsv(rows);
  const filename = `pack376-attendance-all-${scoutingYear}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
