import { requireAdminSession } from "@/lib/authorize";
import { expensesPdfResponse } from "@/lib/tripExports";
import { CAMP_CONRON_SITE } from "@/lib/tripSites";

export async function GET() {
  await requireAdminSession();
  return expensesPdfResponse(CAMP_CONRON_SITE);
}
