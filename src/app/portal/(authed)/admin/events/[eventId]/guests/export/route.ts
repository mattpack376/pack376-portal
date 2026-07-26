import { notFound } from "next/navigation";
import { requireAdminSession } from "@/lib/authorize";
import { getEventDetail } from "@/lib/eventsData";
import { toCsv, centsToDollarsString, csvResponse } from "@/lib/csv";

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  await requireAdminSession();
  const { eventId } = await params;

  const event = await getEventDetail(eventId);
  if (!event) notFound();

  const rows: (string | number)[][] = [
    ["Family Name / Guest Name", "Guest Of", "Adults", "Kids", "Amount Owed", "Paid", "Remaining", "Status", "Added By"],
    ...event.guestGroups.map((g) => [
      g.familyName,
      g.guestOfLabel ?? "",
      g.adultCount,
      g.childCount,
      centsToDollarsString(g.amountOwedCents),
      centsToDollarsString(g.paidCents),
      centsToDollarsString(g.remainingCents),
      g.remainingCents <= 0 ? (g.remainingCents < 0 ? "Overpaid" : "Paid in Full") : g.paidCents > 0 ? "Partial" : "Unpaid",
      g.addedByDisplayName ?? "",
    ]),
  ];

  const safeTitle = event.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "event";
  return csvResponse(toCsv(rows), `pack376-guests-${safeTitle}.csv`);
}
