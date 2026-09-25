import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertLeaderAttendanceAccess } from "@/lib/authorize";
import { fridaysForScoutingYear } from "@/lib/attendanceSchedule";
import { buildAdultLeaderAttendanceCsv, type AdultLeaderAttendanceCsvRow } from "@/lib/attendanceCsv";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("Not authorized.", { status: 401 });
  try {
    assertLeaderAttendanceAccess(session);
  } catch {
    return new NextResponse("Not authorized.", { status: 403 });
  }

  const scoutingYear = request.nextUrl.searchParams.get("scoutingYear");
  if (!scoutingYear) return new NextResponse("Missing scoutingYear query param.", { status: 400 });

  let fridays: Date[];
  try {
    fridays = fridaysForScoutingYear(scoutingYear);
  } catch {
    return new NextResponse("Malformed scoutingYear query param.", { status: 400 });
  }

  const dates = await prisma.meetingDate.findMany({
    where: { date: { gte: fridays[0], lte: fridays[fridays.length - 1] }, status: "SCHEDULED" },
    orderBy: { date: "asc" },
  });
  const dateIds = dates.map((d) => d.id);

  // Everyone on the list now, plus anyone since removed who was marked at
  // least once this season — same rule as the meeting pages.
  const leaders = await prisma.adultLeader.findMany({
    where: { OR: [{ active: true }, { attendances: { some: { meetingDateId: { in: dateIds } } } }] },
    orderBy: [{ section: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    include: { attendances: { where: { meetingDateId: { in: dateIds } } } },
  });

  const rows: AdultLeaderAttendanceCsvRow[] = [];
  for (const leader of leaders) {
    const byDate = new Map(leader.attendances.map((a) => [a.meetingDateId, a.present]));
    for (const meeting of dates) {
      rows.push({
        scoutingYear,
        section: leader.section,
        name: leader.name,
        positions: leader.positions,
        date: meeting.date,
        present: byDate.get(meeting.id) ?? null,
      });
    }
  }

  const csv = buildAdultLeaderAttendanceCsv(rows);
  const filename = `pack376-leader-attendance-${scoutingYear}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
