import { centsToDollarsString, escapeCsvField } from "@/lib/csv";
import { toDateOnlyString } from "@/lib/dateOnly";
import type { DuesExport } from "@/lib/duesExportModel";

/*
 * The dues tracker as two plain tables a spreadsheet can sort and add up:
 * balances (one row per scout, then an all-dens total) and payments (one row
 * per payment). Money is bare dollars ("100.00", "-20.00" when overpaid) so
 * Excel and Sheets read numbers, and a fee that isn't set is an empty cell,
 * never 0.00. Every cell goes through escapeCsvField: names and notes are typed in.
 */

const money = (cents: number | null) => (cents === null ? "" : centsToDollarsString(cents));
const line = (cells: string[]) => cells.map(escapeCsvField).join(",");

export function buildDuesBalancesCsv(data: DuesExport): string {
  const lines = [
    line([
      "Scouting Year",
      "Den",
      "Last Name",
      "First Name",
      "Active",
      "Due",
      "Custom Rate",
      "Paid",
      "Remaining",
      "Status",
      "Payments",
      "Last Payment",
    ]),
  ];
  for (const den of data.dens) {
    for (const s of den.scouts) {
      lines.push(
        line([
          data.scoutingYear,
          den.name,
          s.lastName,
          s.firstName,
          s.active ? "Yes" : "No",
          money(s.dueCents),
          s.isOverridden ? "Yes" : "",
          money(s.paidCents),
          money(s.remainingCents),
          s.status,
          String(s.paymentCount),
          s.lastPaidOn ? toDateOnlyString(s.lastPaidOn) : "",
        ])
      );
    }
  }
  // The page's cards: remaining here is the same never-below-zero figure.
  lines.push(
    line([
      data.scoutingYear,
      "All dens",
      "Total",
      `${data.scoutCount} scout${data.scoutCount === 1 ? "" : "s"}`,
      "",
      money(data.totalDueCents),
      "",
      money(data.collectedCents),
      money(data.remainingCents),
      data.amountCents === null ? "Fee Not Set" : "",
      String(data.payments.length),
      "",
    ])
  );
  return lines.join("\n");
}

export function buildDuesPaymentsCsv(data: DuesExport): string {
  const lines = [line(["Scouting Year", "Den", "Last Name", "First Name", "Paid On", "Amount", "Note"])];
  for (const p of data.payments) {
    lines.push(
      line([
        data.scoutingYear,
        p.denName,
        p.lastName,
        p.firstName,
        toDateOnlyString(p.paidOn),
        money(p.amountCents),
        p.note,
      ])
    );
  }
  return lines.join("\n");
}
