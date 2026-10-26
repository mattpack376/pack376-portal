import { requireAdminSession } from "@/lib/authorize";
import { registrationsCsvResponse } from "@/lib/tripExports";
import { CYCLONES_SITE } from "@/lib/tripSites";

export async function GET(request: Request) {
  await requireAdminSession();
  return registrationsCsvResponse(CYCLONES_SITE, new URL(request.url).searchParams.get("affiliation"));
}
