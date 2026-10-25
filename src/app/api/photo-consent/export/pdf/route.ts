import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  PHOTO_CONSENT_VIEW_LABELS,
  PHOTO_CONSENT_VIEW_SLUGS,
  loadPhotoConsentExport,
  parsePhotoConsentView,
} from "@/lib/photoConsentExport";
import { buildPhotoConsentPdf } from "@/lib/photoConsentPdf";
import { parentsPdfResponse } from "@/lib/parentsPdf";

export async function GET(request: NextRequest) {
  const view = parsePhotoConsentView(request.nextUrl.searchParams.get("view"));
  const result = await loadPhotoConsentExport(view);
  if ("status" in result) return new NextResponse("Not authorized.", { status: result.status });

  const pdf = await buildPhotoConsentPdf(result.dens, { scope: PHOTO_CONSENT_VIEW_LABELS[view] });
  return parentsPdfResponse(pdf, `pack376-photo-consent-${PHOTO_CONSENT_VIEW_SLUGS[view]}.pdf`);
}
