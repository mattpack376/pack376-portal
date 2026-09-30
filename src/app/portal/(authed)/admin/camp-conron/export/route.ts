import { requireAdminSession } from "@/lib/authorize";
import { getOrCreateTripPage, getTripRegistrations, CAMP_CONRON_SLUG } from "@/lib/tripPageData";
import { toCsv, centsToDollarsString, csvResponse } from "@/lib/csv";
import { paymentStatusLabel } from "@/lib/paymentStatus";


export async function GET(request: Request) {
  await requireAdminSession();

  // ?affiliation=PACK|TROOP exports just that group; anything else (or
  // nothing) exports everyone, same as the page's All / Pack 376 / Troop 376 tabs.
  const param = new URL(request.url).searchParams.get("affiliation");
  const affiliation = param === "PACK" || param === "TROOP" ? param : "ALL";

  const trip = await getOrCreateTripPage(CAMP_CONRON_SLUG);
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
  return csvResponse(toCsv(rows), `camp-conron-registrations${suffix}.csv`);
}
