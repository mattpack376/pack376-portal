import type { NextRequest } from "next/server";
import { parentsPdfResponse } from "@/lib/parentsPdf";
import {
  advancementAuditFilename,
  buildAdvancementAuditPdf,
  loadAdvancementAuditExport,
} from "@/lib/advancementAuditExport";

/** Audits -> Advancement as a PDF: every record the page's filters match. Who may download: see loadAdvancementAuditExport. */
export async function GET(request: NextRequest) {
  const result = await loadAdvancementAuditExport(request.nextUrl.searchParams);
  if ("status" in result) return new Response("Not authorized.", { status: result.status });
  const pdf = await buildAdvancementAuditPdf(result.records, result.filters);
  return parentsPdfResponse(pdf, advancementAuditFilename(result.filters, "pdf"));
}
