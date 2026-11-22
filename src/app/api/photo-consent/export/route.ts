import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  PHOTO_CONSENT_VIEW_SLUGS,
  loadPhotoConsentExport,
  parsePhotoConsentView,
} from "@/lib/photoConsentExport";
import { buildPhotoConsentCsv } from "@/lib/photoConsentCsv";
import { csvFileBody } from "@/lib/csv";

export async function GET(request: NextRequest) {
  const view = parsePhotoConsentView(request.nextUrl.searchParams.get("view"));
  const result = await loadPhotoConsentExport(view);
  if ("status" in result) return new NextResponse("Not authorized.", { status: result.status, headers: { "Cache-Control": "private, no-store" } });

  return new NextResponse(csvFileBody(buildPhotoConsentCsv(result.dens)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pack376-photo-consent-${PHOTO_CONSENT_VIEW_SLUGS[view]}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
