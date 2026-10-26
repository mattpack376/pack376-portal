import { requireAdminSession } from "@/lib/authorize";
import { expensesCsvResponse } from "@/lib/tripExports";
import { CYCLONES_SITE } from "@/lib/tripSites";

export async function GET() {
  await requireAdminSession();
  return expensesCsvResponse(CYCLONES_SITE);
}
