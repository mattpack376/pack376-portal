import type { NextRequest } from "next/server";
import { csvResponse } from "@/lib/csv";
import { buildPendingAwardsCsv, loadPendingAwardsExport, pendingAwardsFilename } from "@/lib/pendingAwardsExport";

/** Pending Awards' "By award" list as a CSV. Who may download, and which dens: see loadPendingAwardsExport. */
export async function GET(request: NextRequest) {
  const result = await loadPendingAwardsExport(request.nextUrl.searchParams);
  if ("status" in result) return new Response("Not authorized.", { status: result.status, headers: { "Cache-Control": "private, no-store" } });
  return csvResponse(buildPendingAwardsCsv(result.groups), pendingAwardsFilename(result.year, "csv"));
}
