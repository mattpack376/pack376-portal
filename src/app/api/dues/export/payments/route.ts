import type { NextRequest } from "next/server";
import { csvResponse } from "@/lib/csv";
import { buildDuesPaymentsCsv } from "@/lib/duesCsv";
import { duesExportError, loadDuesExport } from "@/lib/duesExport";
import { duesExportFilename } from "@/lib/duesExportModel";

/** Every dues payment for one scouting year. Admin only (see loadDuesExport). */
export async function GET(request: NextRequest) {
  const result = await loadDuesExport(request.nextUrl.searchParams.get("year"));
  if ("status" in result) return duesExportError(result.status);
  return csvResponse(buildDuesPaymentsCsv(result.data), duesExportFilename(result.data.scoutingYear, "payments", "csv"));
}
