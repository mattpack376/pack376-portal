import type { NextRequest } from "next/server";
import { csvResponse } from "@/lib/csv";
import { buildRankAwardsCsv, loadRankAwardsExport } from "@/lib/pendingAwardsExport";

/** "Ranks awarded" this season as a CSV. Who may download, and which dens: see loadRankAwardsExport. */
export async function GET(request: NextRequest) {
  const result = await loadRankAwardsExport(request.nextUrl.searchParams);
  if ("status" in result) return new Response("Not authorized.", { status: result.status, headers: { "Cache-Control": "private, no-store" } });
  return csvResponse(buildRankAwardsCsv(result.rows), `pack376-ranks-awarded-${result.year}.csv`);
}
