import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canExportLeaderContacts } from "@/lib/authorize";
import { getLeaderContactList } from "@/lib/adultLeaderAttendanceData";
import { buildLeaderContactsCsv } from "@/lib/leadersCsv";

// Admin and Junior Admin, like the parent contact exports (canExportLeaderContacts).
export async function GET() {
  const session = await getSession();
  if (!session) return new NextResponse("Not authorized.", { status: 401 });
  if (!canExportLeaderContacts(session)) return new NextResponse("Not authorized.", { status: 403 });

  const csv = buildLeaderContactsCsv(await getLeaderContactList());

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pack376-committee-leaders-contacts.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
