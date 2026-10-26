import { requireAdminSession } from "@/lib/authorize";
import { expensesPdfResponse } from "@/lib/tripExports";
import { CYCLONES_SITE } from "@/lib/tripSites";

export async function GET() {
  await requireAdminSession();
  return expensesPdfResponse(CYCLONES_SITE);
}
