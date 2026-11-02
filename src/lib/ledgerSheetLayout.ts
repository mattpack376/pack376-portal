import { PACK_TIME_ZONE } from "@/lib/dateOnly";
import type { LedgerCategorySummary, LedgerDirection, LedgerSummary } from "@/lib/ledgerMath";
import type { SheetCell, SheetGrid, SheetRow } from "@/lib/googleSheets";

/*
 * What the portal writes to its "Portal Ledger" tab: a look like the top of
 * the treasurer's Sheet, then every line oldest first. Pure — no Google or
 * database — so it's tested on its own.
 *
 * Every cell is a typed value (text, number); never a formula. Text is stored
 * as text even when it starts with "=", so a description can't run in the
 * Sheet. Dates go in as Sheets serial numbers and money as plain numbers,
 * each with its number format, so the Sheet can still add them up.
 *
 * Layout (rows): the title, "Last updated", the summary, then the column
 * header and the lines. Sheets can only freeze rows from the top, so keeping
 * the header in view while scrolling freezes everything above it too. To keep
 * that frozen area small (it shares the screen with the lines, especially in
 * the phone app), the summary runs ACROSS the columns — names on one row,
 * amounts on the row below, up to 7 a row — instead of one box per row as in
 * the old Sheet. If there are so many categories that the frozen area would
 * still be large, nothing is frozen.
 */

export const LEDGER_SHEET_TITLE = "Pack 376 Transactions Ledger — written by the portal. Edits here are overwritten.";
export const LEDGER_SHEET_HEADER = ["Date", "Description", "Category", "Inflow (+)", "Outflow (-)", "Running Balance", "Type"];
/** Summary items per row: one per table column. */
const SUMMARY_PER_ROW = LEDGER_SHEET_HEADER.length;
/** More frozen rows than this and nothing is frozen. */
export const MAX_FROZEN_ROWS = 10;

const DATE_FORMAT = { type: "DATE", pattern: "m/d/yy" } as const;
const MONEY_FORMAT = { type: "CURRENCY", pattern: '"$"#,##0.00' } as const;
const DAY_MS = 86_400_000;
/** Day 0 of Sheets' (and Excel's) date serials. */
const SERIAL_EPOCH = Date.UTC(1899, 11, 30);

/** What the layout needs of a ledger line (LedgerRow from ledgerData fits). */
export type LedgerSheetLine = {
  entryDate: Date;
  description: string;
  categoryName: string;
  direction: LedgerDirection;
  amountCents: number;
  balanceCents: number;
  origin: string;
  transferId: string | null;
};

export type LedgerSheetSnapshot = {
  /** Every line that counts, oldest first, with its running balance. */
  allRows: readonly LedgerSheetLine[];
  summary: LedgerSummary;
};

/** A date-only value (UTC midnight) as a Sheets date serial: 1/1/2026 is 46023. */
export function sheetDateSerial(date: Date): number {
  return Math.round((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - SERIAL_EPOCH) / DAY_MS);
}

/** What kind of line it is, as the Type column (and the CSV export) says it. */
export function ledgerLineType(line: Pick<LedgerSheetLine, "origin" | "transferId">): string {
  if (line.transferId) return "Transfer";
  if (line.origin === "IMPORTED") return "Imported";
  if (line.origin === "SNAPSHOT") return "Portal";
  return "Entered";
}

function text(value: string, format?: { bold?: boolean; italic?: boolean; wrap?: boolean }): SheetCell {
  const cell: SheetCell = { userEnteredValue: { stringValue: value } };
  if (format?.bold || format?.italic) cell.userEnteredFormat = { textFormat: { bold: format.bold, italic: format.italic } };
  if (format?.wrap) cell.userEnteredFormat = { ...cell.userEnteredFormat, wrapStrategy: "WRAP" };
  return cell;
}

function money(cents: number, bold = false): SheetCell {
  const cell: SheetCell = { userEnteredValue: { numberValue: cents / 100 }, userEnteredFormat: { numberFormat: MONEY_FORMAT } };
  if (bold) cell.userEnteredFormat = { ...cell.userEnteredFormat, textFormat: { bold: true } };
  return cell;
}

const EMPTY: SheetCell = {};

/** "Nov 2, 2026, 3:14 PM ET" in the pack's time zone. */
function updatedLabel(now: Date): string {
  const when = now.toLocaleString("en-US", { timeZone: PACK_TIME_ZONE, dateStyle: "medium", timeStyle: "short" });
  return `Last updated ${when.replace(/ /g, " ")} ET`;
}

/** Name/amount pairs laid out across: a row of names, then a row of amounts, repeated. */
function summaryRows(items: { label: string; cents: number; bold?: boolean }[], lead?: SheetCell): SheetRow[] {
  const rows: SheetRow[] = [];
  const perRow = lead ? SUMMARY_PER_ROW - 1 : SUMMARY_PER_ROW;
  for (let i = 0; i < items.length; i += perRow) {
    const chunk = items.slice(i, i + perRow);
    const pad = lead ? [i === 0 ? lead : EMPTY] : [];
    rows.push({ values: [...pad, ...chunk.map((item) => text(item.label, { bold: true, wrap: true }))] });
    rows.push({ values: [...(lead ? [EMPTY] : []), ...chunk.map((item) => money(item.cents, item.bold))] });
  }
  return rows;
}

/** An archived category with nothing left in it has nothing to report (as on the page). */
function shown(category: LedgerCategorySummary) {
  return !category.archived || category.netCents !== 0;
}

/** The whole tab, top to bottom. */
export function buildLedgerSheetGrid(snapshot: LedgerSheetSnapshot, { now }: { now: Date }): SheetGrid {
  const { summary } = snapshot;
  const rows: SheetRow[] = [
    { values: [text(LEDGER_SHEET_TITLE, { bold: true })] },
    { values: [text(updatedLabel(now), { italic: true })] },
  ];

  const funds = summary.categories.filter((c) => c.kind === "FUND" && shown(c));
  rows.push(
    ...summaryRows([
      { label: "Total Bank Balance", cents: summary.bankBalanceCents, bold: true },
      { label: "Available to Spend", cents: summary.availableToSpendCents, bold: true },
      ...funds.map((c) => ({ label: c.name, cents: c.netCents })),
    ]),
  );

  const events = summary.categories.filter((c) => c.kind === "EVENT" && shown(c));
  if (events.length > 0) {
    rows.push(
      ...summaryRows(
        events.map((c) => ({ label: c.name, cents: c.netCents })),
        text("Balances for Events:", { bold: true, wrap: true }),
      ),
    );
  }

  rows.push({ values: LEDGER_SHEET_HEADER.map((label) => text(label, { bold: true })) });
  const headerRows = rows.length;

  for (const line of snapshot.allRows) {
    rows.push({
      values: [
        { userEnteredValue: { numberValue: sheetDateSerial(line.entryDate) }, userEnteredFormat: { numberFormat: DATE_FORMAT } },
        text(line.description),
        text(line.categoryName),
        line.direction === "IN" ? money(line.amountCents) : EMPTY,
        line.direction === "OUT" ? money(line.amountCents) : EMPTY,
        money(line.balanceCents),
        text(ledgerLineType(line)),
      ],
    });
  }

  return { rows, frozenRowCount: headerRows <= MAX_FROZEN_ROWS ? headerRows : 0 };
}
