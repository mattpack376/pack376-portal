import { requireAdminSession } from "@/lib/authorize";
import { getAllGuestGroups, getAllRegistrations } from "@/lib/eventsData";
import { toCsv, centsToDollarsString, csvResponse } from "@/lib/csv";
import { formatDueDate } from "@/lib/deadlineCategories";
import { denDisplayName } from "@/lib/rankConfig";

function statusFor(remainingCents: number, paidCents: number) {
  return remainingCents <= 0 ? (remainingCents < 0 ? "Overpaid" : "Paid in Full") : paidCents > 0 ? "Partial" : "Unpaid";
}

export async function GET() {
  await requireAdminSession();

  const [registrations, groups] = await Promise.all([getAllRegistrations(), getAllGuestGroups()]);

  const rows: (string | number)[][] = [
    ["Event", "Event Date", "Type", "Name", "Den / Guest Of", "Adults", "Kids", "Amount Owed", "Paid", "Remaining", "Status", "Added By"],
    ...registrations.map((reg) => [
      reg.event.title,
      formatDueDate(reg.event.eventDate),
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
    ...groups.map((g) => [
      g.event.title,
      formatDueDate(g.event.eventDate),
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

  return csvResponse(toCsv(rows), "pack376-all-attendees.csv");
}
