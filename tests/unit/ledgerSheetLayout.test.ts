/*
 * The "Portal Ledger" tab's layout (src/lib/ledgerSheetLayout.ts): typed
 * cells only (a description starting with "=" stays text), Sheets date
 * serials, number formats with their type set, and where the summary and the
 * frozen header land. All names and amounts are invented.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LEDGER_SHEET_HEADER,
  LEDGER_SHEET_TITLE,
  MAX_FROZEN_ROWS,
  buildLedgerSheetGrid,
  ledgerLineType,
  sheetDateSerial,
  type LedgerSheetLine,
} from "@/lib/ledgerSheetLayout";
import { summarizeLedger, withRunningBalance, type LedgerMathCategory } from "@/lib/ledgerMath";
import type { SheetCell, SheetGrid } from "@/lib/googleSheets";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const CATEGORIES: LedgerMathCategory[] = [
  { id: "gen", name: "General Fund", kind: "FUND", sortOrder: 0, archived: false },
  { id: "fun", name: "Fundraising", kind: "FUND", sortOrder: 1, archived: false },
  { id: "old", name: "Old Fund", kind: "FUND", sortOrder: 2, archived: true },
  { id: "camp", name: "Fall Campout", kind: "EVENT", sortOrder: 3, archived: false },
];
const NAMES = new Map(CATEGORIES.map((c) => [c.id, c.name]));

function snapshot() {
  const entries = [
    { id: "a", entryDate: day("2026-09-05"), importRowNumber: 3, createdAt: day("2026-10-01"), direction: "IN" as const, amountCents: 50_000, categoryId: "gen", transferId: null, description: "Opening deposit", origin: "IMPORTED" },
    { id: "b", entryDate: day("2026-09-20"), importRowNumber: null, createdAt: day("2026-10-02"), direction: "OUT" as const, amountCents: 12_345, categoryId: "camp", transferId: null, description: '=HYPERLINK("http://example.invalid","x")', origin: "MANUAL" },
    { id: "c", entryDate: day("2026-10-01"), importRowNumber: null, createdAt: day("2026-10-03"), direction: "IN" as const, amountCents: 20_000, categoryId: "camp", transferId: null, description: "+cmd|' /C calc'!A0", origin: "MANUAL" },
    { id: "d", entryDate: day("2026-10-02"), importRowNumber: null, createdAt: day("2026-10-04"), direction: "OUT" as const, amountCents: 5_000, categoryId: "camp", transferId: "t1", description: "Move to Fundraising", origin: "MANUAL" },
    { id: "e", entryDate: day("2026-10-02"), importRowNumber: null, createdAt: day("2026-10-04"), direction: "IN" as const, amountCents: 5_000, categoryId: "fun", transferId: "t1", description: "Move from Fall Campout", origin: "MANUAL" },
  ];
  const allRows: LedgerSheetLine[] = withRunningBalance(entries).map((e) => ({ ...e, categoryName: NAMES.get(e.categoryId) ?? "" }));
  return { allRows, summary: summarizeLedger(entries, CATEGORIES) };
}

const NOW = new Date("2026-11-02T20:14:00.000Z"); // 3:14 PM Eastern

function value(cell: SheetCell | undefined) {
  const v = cell?.userEnteredValue;
  if (!v) return undefined;
  return "stringValue" in v ? v.stringValue : "numberValue" in v ? v.numberValue : v.boolValue;
}
const rowText = (grid: SheetGrid, index: number) => grid.rows[index].values.map(value);

describe("date serials", () => {
  it("count days from 12/30/1899, as Sheets does", () => {
    assert.equal(sheetDateSerial(day("1899-12-31")), 1);
    assert.equal(sheetDateSerial(day("2026-01-01")), 46023);
    assert.equal(sheetDateSerial(day("2026-12-31")), 46387);
    // Daylight saving starts and ends: still whole days.
    assert.equal(sheetDateSerial(day("2026-03-08")), 46089);
    assert.equal(sheetDateSerial(day("2026-11-01")), 46327);
  });
});

describe("the grid", () => {
  const grid = buildLedgerSheetGrid(snapshot(), { now: NOW });

  it("only ever holds typed text and numbers — never a formula", () => {
    for (const row of grid.rows) {
      assert.ok(row.values.length <= 8, "more than 8 columns");
      for (const cell of row.values) {
        const v = cell.userEnteredValue;
        if (!v) continue;
        assert.equal(Object.keys(v).length, 1);
        assert.ok("stringValue" in v || "numberValue" in v, JSON.stringify(v));
      }
    }
    assert.doesNotMatch(JSON.stringify(grid), /formulaValue/);
    const formulaLike = grid.rows.flatMap((r) => r.values).find((c) => value(c) === '=HYPERLINK("http://example.invalid","x")');
    assert.deepEqual(formulaLike?.userEnteredValue, { stringValue: '=HYPERLINK("http://example.invalid","x")' });
  });

  it("starts with the title and the Eastern update time", () => {
    assert.equal(value(grid.rows[0].values[0]), LEDGER_SHEET_TITLE);
    assert.equal(value(grid.rows[1].values[0]), "Last updated Nov 2, 2026, 3:14 PM ET");
  });

  it("puts the summary across, funds then events, and freezes through the header", () => {
    assert.deepEqual(rowText(grid, 2), ["Total Bank Balance", "Available to Spend", "General Fund", "Fundraising"]);
    // 500 - 123.45 + 200 = 576.55 in the bank; 26.55 of it is the campout's (after moving 50 out).
    assert.deepEqual(rowText(grid, 3), [576.55, 550, 500, 50]);
    assert.deepEqual(rowText(grid, 4), ["Balances for Events:", "Fall Campout"]);
    assert.deepEqual(rowText(grid, 5), [undefined, 26.55]);
    assert.deepEqual(rowText(grid, 6), LEDGER_SHEET_HEADER);
    assert.equal(grid.frozenRowCount, 7);
    // An archived category with nothing in it isn't listed.
    assert.ok(!JSON.stringify(grid.rows.slice(0, 7)).includes("Old Fund"));
  });

  it("lists every line oldest first with dates, amounts, running balance and type", () => {
    const lines = grid.rows.slice(grid.frozenRowCount);
    assert.equal(lines.length, 5);
    assert.deepEqual(lines.map((r) => r.values.map(value)), [
      [46270, "Opening deposit", "General Fund", 500, undefined, 500, "Imported"],
      [46285, '=HYPERLINK("http://example.invalid","x")', "Fall Campout", undefined, 123.45, 376.55, "Entered"],
      [46296, "+cmd|' /C calc'!A0", "Fall Campout", 200, undefined, 576.55, "Entered"],
      [46297, "Move to Fundraising", "Fall Campout", undefined, 50, 526.55, "Transfer"],
      [46297, "Move from Fall Campout", "Fundraising", 50, undefined, 576.55, "Transfer"],
    ]);
  });

  it("gives dates and money a number format with its type", () => {
    const line = grid.rows[grid.frozenRowCount].values;
    assert.deepEqual(line[0].userEnteredFormat?.numberFormat, { type: "DATE", pattern: "m/d/yy" });
    assert.deepEqual(line[3].userEnteredFormat?.numberFormat, { type: "CURRENCY", pattern: '"$"#,##0.00' });
    assert.deepEqual(line[5].userEnteredFormat?.numberFormat, { type: "CURRENCY", pattern: '"$"#,##0.00' });
    assert.deepEqual(grid.rows[3].values[0].userEnteredFormat?.numberFormat, { type: "CURRENCY", pattern: '"$"#,##0.00' });
    for (const row of grid.rows) {
      for (const cell of row.values) {
        const format = cell.userEnteredFormat?.numberFormat;
        if (format) assert.ok(format.type, "a number format without its type is refused by Sheets");
      }
    }
  });

  it("freezes nothing when the summary would take up too much of the screen", () => {
    const many: LedgerMathCategory[] = Array.from({ length: 40 }, (_, i) => ({
      id: `c${i}`,
      name: `Category ${i}`,
      kind: i % 2 ? "EVENT" : "FUND",
      sortOrder: i,
      archived: false,
    }));
    const big = buildLedgerSheetGrid({ allRows: [], summary: summarizeLedger([], many) }, { now: NOW });
    const header = big.rows.findIndex((r) => value(r.values[0]) === "Date");
    assert.ok(header + 1 > MAX_FROZEN_ROWS);
    assert.equal(big.frozenRowCount, 0);
    assert.ok(big.rows.every((r) => r.values.length <= 7));
  });

  it("names each kind of line", () => {
    assert.equal(ledgerLineType({ origin: "MANUAL", transferId: null }), "Entered");
    assert.equal(ledgerLineType({ origin: "IMPORTED", transferId: null }), "Imported");
    assert.equal(ledgerLineType({ origin: "MANUAL", transferId: "t" }), "Transfer");
  });
});
