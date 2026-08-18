import { requireAdminSession } from "@/lib/authorize";
import { getOrCreateTripPage, getTripRegistrations, CAMP_CONRON_SLUG } from "@/lib/tripPageData";
import { toCsv, centsToDollarsString, csvResponse } from "@/lib/csv";

function statusFor(remainingCents: number, paidCents: number) {
  return remainingCents <= 0 ? (remainingCents < 0 ? "Overpaid" : "Paid in Full") : paidCents > 0 ? "Partial" : "Unpaid";
}

export async function GET() {
  await requireAdminSession();

  const trip = await getOrCreateTripPage(CAMP_CONRON_SLUG);
  const registrations = await getTripRegistrations(trip.id);

  const rows: (string | number)[][] = [
    ["Family / Registrant", "Email", "Phone", "Affiliation", "Paying", "Free", "Amount Owed", "Paid", "Remaining", "Status", "Registered"],
    ...registrations.map((reg) => [
      reg.familyName,
      reg.contactEmail,
      reg.contactPhone ?? "",
      reg.affiliation === "PACK" ? "Pack 376" : "Troop 376",
      reg.payingCount,
      reg.freeCount,
      centsToDollarsString(reg.amountOwedCents),
      centsToDollarsString(reg.paidCents),
      centsToDollarsString(reg.remainingCents),
      statusFor(reg.remainingCents, reg.paidCents),
      reg.createdAt.toISOString().slice(0, 10),
    ]),
  ];

  return csvResponse(toCsv(rows), "camp-conron-registrations.csv");
}
