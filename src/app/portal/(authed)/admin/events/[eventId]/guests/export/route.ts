import { notFound } from "next/navigation";
import { requireAdminSession } from "@/lib/authorize";
import { getEventDetail } from "@/lib/eventsData";
import { toCsv, centsToDollarsString, csvResponse } from "@/lib/csv";
import { denDisplayName } from "@/lib/rankConfig";

function statusFor(remainingCents: number, paidCents: number) {
  return remainingCents <= 0 ? (remainingCents < 0 ? "Overpaid" : "Paid in Full") : paidCents > 0 ? "Partial" : "Unpaid";
}

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  await requireAdminSession();
  const { eventId } = await params;

  const event = await getEventDetail(eventId);
  if (!event) notFound();

  const rows: (string | number)[][] = [
    ["Type", "Name", "Den / Guest Of", "Adults", "Kids", "Amount Owed", "Paid", "Remaining", "Status", "Added By"],
    ...event.registrations.map((reg) => [
      "Scout",
      `${reg.scout.firstName} ${reg.scout.lastName}`,
      denDisplayName(reg.scout.den.rank, reg.scout.den.scoutingYear, reg.scout.den.label),
      "",
      "",
      centsToDollarsString(reg.amountOwedCents),
      centsToDollarsString(reg.paidCents),
      centsToDollarsString(reg.remainingCents),
      statusFor(reg.remainingCents, reg.paidCents),
      "",
    ]),
    ...event.guestGroups.map((g) => [
      "Guest",
      g.familyName,
      g.guestOfLabel ?? "",
      g.adultCount,
      g.childCount,
      centsToDollarsString(g.amountOwedCents),
      centsToDollarsString(g.paidCents),
      centsToDollarsString(g.remainingCents),
      statusFor(g.remainingCents, g.paidCents),
      g.addedByDisplayName ?? "",
    ]),
  ];

  const safeTitle = event.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "event";
  return csvResponse(toCsv(rows), `pack376-attendees-${safeTitle}.csv`);
}
