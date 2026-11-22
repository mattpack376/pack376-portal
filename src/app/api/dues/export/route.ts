import type { NextRequest } from "next/server";
import { csvResponse } from "@/lib/csv";
import { buildDuesBalancesCsv } from "@/lib/duesCsv";
import { duesExportError, loadDuesExport } from "@/lib/duesExport";
import { duesExportFilename } from "@/lib/duesExportModel";

/** Dues balances for one scouting year, one row per scout. Admin only (see loadDuesExport). */
export async function GET(request: NextRequest) {
  const result = await loadDuesExport(request.nextUrl.searchParams.get("year"));
  if ("status" in result) return duesExportError(result.status);
  return csvResponse(buildDuesBalancesCsv(result.data), duesExportFilename(result.data.scoutingYear, "balances", "csv"));
}
