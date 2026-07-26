import { requireAdminSession } from "@/lib/authorize";
import { getAllGuestGroups } from "@/lib/eventsData";
import { toCsv, centsToDollarsString, csvResponse } from "@/lib/csv";
import { formatDueDate } from "@/lib/deadlineCategories";

export async function GET() {
  await requireAdminSession();

  const groups = await getAllGuestGroups();

  const rows: (string | number)[][] = [
    ["Event", "Event Date", "Family / Leader Name", "Guest Of", "Adults", "Kids", "Amount Owed", "Paid", "Remaining", "Status", "Added By"],
    ...groups.map((g) => [
      g.event.title,
      formatDueDate(g.event.eventDate),
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

  return csvResponse(toCsv(rows), "pack376-all-guests.csv");
}
