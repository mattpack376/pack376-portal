import type { NextRequest } from "next/server";
import { parentsPdfResponse } from "@/lib/parentsPdf";
import { buildPendingAwardsPdf, loadPendingAwardsExport, pendingAwardsFilename } from "@/lib/pendingAwardsExport";

/** Pending Awards' "By award" list as a PDF. Who may download, and which dens: see loadPendingAwardsExport. */
export async function GET(request: NextRequest) {
  const result = await loadPendingAwardsExport(request.nextUrl.searchParams);
  if ("status" in result) return new Response("Not authorized.", { status: result.status, headers: { "Cache-Control": "private, no-store" } });
  const pdf = await buildPendingAwardsPdf(result.groups, result);
  return parentsPdfResponse(pdf, pendingAwardsFilename(result.year, "pdf"));
}
