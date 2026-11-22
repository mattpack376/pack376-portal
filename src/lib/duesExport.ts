import "server-only";
import { getSession } from "@/lib/auth";
import { canExportDues } from "@/lib/authorize";
import { getDuesOverview, getDuesScoutingYears } from "@/lib/duesData";
import { buildDuesExportModel, type DuesExport } from "@/lib/duesExportModel";

/*
 * Loader for the dues exports (/api/dues/export, .../payments, .../pdf).
 * Admin only (canExportDues): Junior Admin and Committee Member can read the
 * Dues page but get 403 here. The year must be one the page offers; with none
 * given it's the newest, as on the page.
 */
export async function loadDuesExport(
  rawYear: string | null
): Promise<{ status: 401 | 403 | 404 } | { data: DuesExport }> {
  const session = await getSession();
  if (!session) return { status: 401 };
  if (!canExportDues(session)) return { status: 403 };

  const years = await getDuesScoutingYears();
  const scoutingYear = rawYear ? (years.includes(rawYear) ? rawYear : null) : years[0];
  if (!scoutingYear) return { status: 404 };

  return { data: buildDuesExportModel(await getDuesOverview(scoutingYear)) };
}

const STATUS_TEXT = { 401: "Not signed in.", 403: "Not authorized.", 404: "Not found." } as const;

export function duesExportError(status: 401 | 403 | 404): Response {
  return new Response(STATUS_TEXT[status], { status, headers: { "Cache-Control": "private, no-store" } });
}
