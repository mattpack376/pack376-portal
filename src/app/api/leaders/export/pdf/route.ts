import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canExportLeaderContacts } from "@/lib/authorize";
import { getLeaderContactList } from "@/lib/adultLeaderAttendanceData";
import { buildLeadersPdf } from "@/lib/leadersPdf";
import { parentsPdfResponse } from "@/lib/parentsPdf";

// Admin and Junior Admin, like the parent contact exports (canExportLeaderContacts).
export async function GET() {
  const session = await getSession();
  if (!session) return new NextResponse("Not authorized.", { status: 401 });
  if (!canExportLeaderContacts(session)) return new NextResponse("Not authorized.", { status: 403 });

  const pdf = await buildLeadersPdf(await getLeaderContactList());
  return parentsPdfResponse(pdf, "pack376-committee-leaders-contacts.pdf");
}
