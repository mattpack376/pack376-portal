import type { NextRequest } from "next/server";
import { csvResponse } from "@/lib/csv";
import {
  advancementAuditFilename,
  buildAdvancementAuditCsv,
  loadAdvancementAuditExport,
} from "@/lib/advancementAuditExport";

/** Audits -> Advancement as a CSV: every record the page's filters match. Who may download: see loadAdvancementAuditExport. */
export async function GET(request: NextRequest) {
  const result = await loadAdvancementAuditExport(request.nextUrl.searchParams);
  if ("status" in result) return new Response("Not authorized.", { status: result.status });
  return csvResponse(buildAdvancementAuditCsv(result.records), advancementAuditFilename(result.filters, "csv"));
}
