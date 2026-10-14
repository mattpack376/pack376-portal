import { requireAdminSession } from "@/lib/authorize";
import { getOrCreateTripPage, getTripExpenses, getTripRegistrations, CAMP_CONRON_SLUG } from "@/lib/tripPageData";
import { buildTripExpensesPdf } from "@/lib/tripExpensesPdf";
import { parentsPdfResponse } from "@/lib/parentsPdf";

// The CSV export beside it (../route.ts) as a PDF — same items, same totals, Admin only.
export async function GET() {
  await requireAdminSession();

  const trip = await getOrCreateTripPage(CAMP_CONRON_SLUG);
  const [expenses, registrations] = await Promise.all([getTripExpenses(trip.id), getTripRegistrations(trip.id)]);
  const collectedCents = registrations.reduce((sum, r) => sum + r.paidCents, 0);

  const pdf = await buildTripExpensesPdf(expenses, { tripTitle: trip.title, collectedCents });
  return parentsPdfResponse(pdf, "camp-conron-expenses.pdf");
}
