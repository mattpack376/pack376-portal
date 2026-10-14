import { requireAdminSession } from "@/lib/authorize";
import {
  getOrCreateTripPage,
  getTripExpenses,
  getTripRegistrations,
  tripExpenseTotals,
  CAMP_CONRON_SLUG,
} from "@/lib/tripPageData";
import { toCsv, centsToDollarsString, csvResponse } from "@/lib/csv";
import { toDateOnlyString } from "@/lib/dateOnly";

/**
 * Every expense and vendor credit/refund, oldest first, then the same totals
 * the admin page's Money card shows. Credits are negative in the Amount
 * column, so summing just the item rows gives Net Expenses.
 */
export async function GET() {
  await requireAdminSession();

  const trip = await getOrCreateTripPage(CAMP_CONRON_SLUG);
  const [expenses, registrations] = await Promise.all([getTripExpenses(trip.id), getTripRegistrations(trip.id)]);
  const { spentCents, creditCents, netCents } = tripExpenseTotals(expenses);
  const collectedCents = registrations.reduce((sum, r) => sum + r.paidCents, 0);

  const total = (label: string, cents: number) => ["", "", label, "", centsToDollarsString(cents)];

  const rows: (string | number)[][] = [
    ["Date", "Type", "Description", "Paid / Received By", "Amount", "Recorded By", "Recorded On"],
    ...expenses.map((e) => [
      toDateOnlyString(e.spentOn),
      e.isCredit ? "Credit / Refund" : "Expense",
      e.description,
      e.paidBy ?? "",
      centsToDollarsString(e.isCredit ? -e.amountCents : e.amountCents),
      e.recordedByUser?.username ?? "",
      e.createdAt.toISOString().slice(0, 10),
    ]),
    [],
    total("Total Expenses", spentCents),
    total("Total Credits & Refunds", -creditCents),
    total("Net Expenses", netCents),
    total("Collected So Far", collectedCents),
    total("Available to Spend (Collected So Far)", collectedCents - netCents),
  ];

  return csvResponse(toCsv(rows), "camp-conron-expenses.csv");
}
