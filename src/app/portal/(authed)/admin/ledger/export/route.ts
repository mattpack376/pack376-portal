import { requireLedgerSession } from "@/lib/authorize";
import { getLedger } from "@/lib/ledgerData";
import { parseLedgerScoutingYear } from "@/lib/ledgerMath";
import { toCsv, centsToDollarsString, csvResponse } from "@/lib/csv";
import { toDateOnlyString, todayDateOnlyString } from "@/lib/dateOnly";

export const maxDuration = 60;

/**
 * The ledger as a CSV, oldest first: one scouting year (?year=2026-2027) or
 * every line (?year=all, or no year). The running balance is the real bank
 * balance after each line, counting every year. Ledger accounts only; the
 * shared CSV helpers neutralize formula injection and send it private,
 * no-store.
 */
export async function GET(request: Request) {
  await requireLedgerSession();

  const year = parseLedgerScoutingYear(new URL(request.url).searchParams.get("year"));
  const { rows } = await getLedger({ year });

  const csv = toCsv([
    ["Date", "Description", "Category", "Inflow", "Outflow", "Running Balance", "Type"],
    ...rows.map((row) => [
      toDateOnlyString(row.entryDate),
      row.description,
      row.categoryName,
      row.direction === "IN" ? centsToDollarsString(row.amountCents) : "",
      row.direction === "OUT" ? centsToDollarsString(row.amountCents) : "",
      centsToDollarsString(row.balanceCents),
      row.transferId ? "Transfer" : row.origin === "IMPORTED" ? "Imported" : "Entered",
    ]),
  ]);

  return csvResponse(csv, `pack376-ledger-${year ?? "all-years"}-${todayDateOnlyString()}.csv`);
}
