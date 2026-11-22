import type { NextRequest } from "next/server";
import { safeDownloadFilename } from "@/lib/csv";
import { duesExportError, loadDuesExport } from "@/lib/duesExport";
import { duesExportFilename } from "@/lib/duesExportModel";
import { buildDuesPdf } from "@/lib/duesPdf";
import { parentsPdfResponse } from "@/lib/parentsPdf";

/** The dues tracker for one scouting year as a PDF. Admin only (see loadDuesExport). */
export async function GET(request: NextRequest) {
  const result = await loadDuesExport(request.nextUrl.searchParams.get("year"));
  if ("status" in result) return duesExportError(result.status);
  const pdf = await buildDuesPdf(result.data);
  return parentsPdfResponse(pdf, safeDownloadFilename(duesExportFilename(result.data.scoutingYear, "balances", "pdf")));
}
