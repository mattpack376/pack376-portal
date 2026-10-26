import { requireAdminSession } from "@/lib/authorize";
import { expensesCsvResponse } from "@/lib/tripExports";
import { CAMP_CONRON_SITE } from "@/lib/tripSites";

export async function GET() {
  await requireAdminSession();
  return expensesCsvResponse(CAMP_CONRON_SITE);
}
