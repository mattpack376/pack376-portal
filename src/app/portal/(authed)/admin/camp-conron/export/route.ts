import { requireAdminSession } from "@/lib/authorize";
import { registrationsCsvResponse } from "@/lib/tripExports";
import { CAMP_CONRON_SITE } from "@/lib/tripSites";

export async function GET(request: Request) {
  await requireAdminSession();
  return registrationsCsvResponse(CAMP_CONRON_SITE, new URL(request.url).searchParams.get("affiliation"));
}
