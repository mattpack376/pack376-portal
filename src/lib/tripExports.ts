import "server-only";
import { getOrCreateTripPage, getTripExpenses, getTripRegistrations, tripExpenseTotals } from "@/lib/tripPageData";
import { toCsv, centsToDollarsString, csvResponse } from "@/lib/csv";
import { toDateOnlyString } from "@/lib/dateOnly";
import { paymentStatusLabel } from "@/lib/paymentStatus";
import { buildTripExpensesPdf } from "@/lib/tripExpensesPdf";
import { parentsPdfResponse } from "@/lib/parentsPdf";
import type { TripSite } from "@/lib/tripSites";

/*
 * The CSV and PDF downloads on an event's admin page. Each site's route files
 * (…/camp-conron/export, …/cyclones/export) check requireAdminSession and call
 * these with their site; the guard stays in the route so it's visible there.
 */

/**
 * Every registration with what it owes and has paid. `affiliationParam` is the
 * page's ?affiliation=PACK|TROOP filter; anything else (or nothing) exports
 * everyone, same as the page's All / Pack 376 / Troop 376 tabs.
 */
export async function registrationsCsvResponse(site: TripSite, affiliationParam: string | null) {
  const affiliation = affiliationParam === "PACK" || affiliationParam === "TROOP" ? affiliationParam : "ALL";

  const trip = await getOrCreateTripPage(site.slug);
  const allRegistrations = await getTripRegistrations(trip.id);
  const registrations =
    affiliation === "ALL" ? allRegistrations : allRegistrations.filter((reg) => reg.affiliation === affiliation);

  const rows: (string | number)[][] = [
    ["Family / Registrant", "Guest Of", "Email", "Phone", "Affiliation", "Paying", "Free", "Amount Owed", "Paid", "Remaining", "Status", "Registered"],
    ...registrations.map((reg) => [
      reg.familyName,
      reg.guestOfName,
      reg.contactEmail,
      reg.contactPhone ?? "",
      reg.affiliation === "PACK" ? "Pack 376" : "Troop 376",
      reg.payingCount,
      reg.freeCount,
      centsToDollarsString(reg.amountOwedCents),
      centsToDollarsString(reg.paidCents),
      centsToDollarsString(reg.remainingCents),
      paymentStatusLabel(reg.remainingCents, reg.paidCents),
      reg.createdAt.toISOString().slice(0, 10),
    ]),
  ];

  const suffix = affiliation === "ALL" ? "" : `-${affiliation.toLowerCase()}`;
  return csvResponse(toCsv(rows), `${site.fileStem}-registrations${suffix}.csv`);
}

/**
 * Every expense and vendor credit/refund, oldest first, then the same totals
 * the admin page's Money card shows. Credits are negative in the Amount
 * column, so summing just the item rows gives Net Expenses.
 */
export async function expensesCsvResponse(site: TripSite) {
  const trip = await getOrCreateTripPage(site.slug);
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

  return csvResponse(toCsv(rows), `${site.fileStem}-expenses.csv`);
}

/** The expenses CSV above as a PDF — same items, same totals. */
export async function expensesPdfResponse(site: TripSite) {
  const trip = await getOrCreateTripPage(site.slug);
  const [expenses, registrations] = await Promise.all([getTripExpenses(trip.id), getTripRegistrations(trip.id)]);
  const collectedCents = registrations.reduce((sum, r) => sum + r.paidCents, 0);

  const pdf = await buildTripExpensesPdf(expenses, { tripTitle: trip.title, collectedCents });
  return parentsPdfResponse(pdf, `${site.fileStem}-expenses.pdf`);
}
