/*
 * The Ledger import's Sheet reader. The fixture is shaped like the
 * treasurer's tab (title and summary boxes on top, the header on row 9 with
 * column A blank, lines from row 10), but every name and amount is invented.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultCutoverDate,
  defaultImportTab,
  findTransferPairs,
  guessLedgerCategoryKind,
  parseLedgerGrid,
  type LedgerImportCell,
} from "@/lib/ledgerImport";
import { parseCsv } from "@/lib/csvParse";

const TODAY = new Date("2026-11-02T00:00:00.000Z");
type Grid = LedgerImportCell[][];

/** A fresh copy of the invented tab, as the Sheets API returns it (numbers, a serial date, ragged rows). */
function sheet(): Grid {
  return [
    [],
    ["", "Pack 999 Transactions Ledger"],
    ["", "Beginning 9/1/26"],
    ["", "Total Bank Balance", "Available to Spend", "Donations", "Fundraising", "Dues"],
    ["", 1390.87, 1015.87, 100, 865.87, 50],
    [],
    ["Balances for Events:", "Fall Campout (Oct)", "Spring Trip"],
    ["", 0, 375],
    ["", "Date", "Description", "Category", "Inflow (+)", "Outflow (-)", "Running Balance"],
    ["", 46266, "Opening balance", "Dues", 50, "", 50],
    ["", "9/5/26", "Family donation", "Donations", 100],
    ["", "9/10/2026", "Popcorn sale", "Fundraising", "$1,234.56", "", 1384.56],
    ["", "9/12/26", "Popcorn supplier", "Fundraising", "", 984.31, 400.25],
    ["", "10/1/26", "Fall Campout payments total", "Fall Campout (Oct)", 3405.9, "", 3806.15],
    ["", "10/14/26", "Fall Campout expenses total", "Fall Campout (Oct)", "", 2790.28, 1015.8699999999999],
    ["", "10/20/26", "Close out Fall Campout", "Fall Campout (Oct)", "", 615.62, 400.25],
    ["", "10/20/26", "Fall Campout leftover", "Fundraising", 615.62, "", 1015.87],
    ["", "10/25/26", "Spring trip deposits", "Spring Trip", 375],
  ];
}

const parse = (grid: Grid) => parseLedgerGrid(grid, { today: TODAY });

/** The fixture with one row's cells replaced (row = Sheet row number). */
function withRow(row: number, cells: LedgerImportCell[]): Grid {
  const grid = sheet();
  grid[row - 1] = cells;
  return grid;
}

const errorFor = (grid: Grid, row: number) => parse(grid).errors.find((e) => e.sheetRow === row)?.message ?? "";

describe("parseLedgerGrid: the fixture", () => {
  const result = parse(sheet());

  it("finds the header with column A blank and reads every line", () => {
    assert.equal(result.headerRow, 9);
    assert.deepEqual(result.errors, []);
    assert.equal(result.rows.length, 9);
    assert.deepEqual(result.rows[0], {
      sheetRow: 10,
      date: "2026-09-01",
      description: "Opening balance",
      category: "Dues",
      categoryKey: "dues",
      direction: "IN",
      cents: 5000,
    });
  });

  it("reads serial-number dates, M/D/YY and M/D/YYYY", () => {
    assert.deepEqual(
      result.rows.slice(0, 3).map((r) => r.date),
      ["2026-09-01", "2026-09-05", "2026-09-10"],
    );
    const known = parse(withRow(10, ["", 45658, "Opening balance", "Dues", 50, "", 50])).rows[0];
    assert.equal(known.date, "2025-01-01");
  });

  it("reads $1,234.56 text and 3405.9 numbers as whole cents", () => {
    assert.equal(result.rows.find((r) => r.sheetRow === 12)?.cents, 123456);
    assert.equal(result.rows.find((r) => r.sheetRow === 14)?.cents, 340590);
    assert.equal(result.rows.find((r) => r.sheetRow === 13)?.direction, "OUT");
  });

  it("adds up the totals and the categories", () => {
    assert.deepEqual(result.totals, {
      rowCount: 9,
      inflowCents: 578108,
      outflowCents: 439021,
      endingBalanceCents: 139087,
      firstDate: "2026-09-01",
      lastDate: "2026-10-25",
    });
    const nets = Object.fromEntries(result.categories.map((c) => [c.name, c.netCents]));
    assert.deepEqual(nets, { Dues: 5000, Donations: 10000, Fundraising: 86587, "Fall Campout (Oct)": 0, "Spring Trip": 37500 });
    assert.equal(result.categories.find((c) => c.name === "Fundraising")?.count, 3);
  });

  it("reads the summary boxes above the header and checks them against the rows", () => {
    const boxes = Object.fromEntries(result.summaryBoxes.map((b) => [b.label, b.cents]));
    assert.deepEqual(boxes, {
      "Total Bank Balance": 139087,
      "Available to Spend": 101587,
      Donations: 10000,
      Fundraising: 86587,
      Dues: 5000,
      "Fall Campout (Oct)": 0,
      "Spring Trip": 37500,
    });
    for (const check of result.summaryChecks) {
      if (check.label === "Available to Spend") assert.equal(check.matches, null);
      else assert.equal(check.matches, true, check.label);
    }
  });

  it("ignores float noise in running balances, but notes the blank ones in one warning", () => {
    assert.deepEqual(
      result.warnings.map((w) => w.message),
      ["Rows 11, 18: the Running Balance cells are blank. The portal works out its own balances, so this is only a heads-up."],
    );
  });

  it("suggests the close-out as a move between categories", () => {
    assert.deepEqual(result.transferPairs, [
      {
        id: "16-17",
        date: "2026-10-20",
        cents: 61562,
        outRow: 16,
        inRow: 17,
        fromCategory: "Fall Campout (Oct)",
        toCategory: "Fundraising",
      },
    ]);
  });
});

describe("parseLedgerGrid: errors name the Sheet row", () => {
  it("a future date, with a likely fix", () => {
    const message = errorFor(withRow(18, ["", "11/1/29", "Spring trip deposits", "Spring Trip", 375]), 18);
    assert.equal(message, "Row 18: 11/1/2029 is in the future. Probably 11/1/2026? Fix it in the Sheet, then preview again.");
  });

  it("a future date given as a serial number", () => {
    const serial = 46266 + 365 * 3; // about three years after 9/1/26
    assert.match(errorFor(withRow(10, ["", serial, "Opening balance", "Dues", 50]), 10), /^Row 10: .* is in the future\./);
  });

  it("dates that are missing, unreadable, unreal or before 2020", () => {
    assert.match(errorFor(withRow(11, ["", "", "Family donation", "Donations", 100]), 11), /date is missing/);
    assert.match(errorFor(withRow(11, ["", "Sept 5", "Family donation", "Donations", 100]), 11), /isn't a date the import can read/);
    assert.match(errorFor(withRow(11, ["", "2/30/26", "Family donation", "Donations", 100]), 11), /isn't a real date/);
    assert.match(errorFor(withRow(11, ["", "9/5/19", "Family donation", "Donations", 100]), 11), /before 2020/);
  });

  it("both amounts, neither, negative, zero and more than two decimal places", () => {
    const row = (inflow: LedgerImportCell, outflow: LedgerImportCell) =>
      errorFor(withRow(11, ["", "9/5/26", "Family donation", "Donations", inflow, outflow]), 11);
    assert.match(row(100, 5), /both Inflow and Outflow/i);
    assert.match(row("", ""), /neither Inflow nor Outflow/i);
    assert.match(row(-5, ""), /negative/i);
    assert.match(row("-$5.00", ""), /negative/i);
    assert.match(row("", "($5.00)"), /negative/i);
    assert.match(row(0, ""), /\$0/i);
    assert.match(row(1.234, ""), /more than two decimal places/i);
    assert.match(row("1.234", ""), /more than two decimal places/i);
    assert.match(row("ten", ""), /isn't an amount/i);
    assert.match(row(2_000_000, ""), /over \$1,000,000/i);
  });

  it("a blank category or description", () => {
    assert.match(errorFor(withRow(11, ["", "9/5/26", "Family donation", "", 100]), 11), /^Row 11: The category is missing\.$/);
    assert.match(errorFor(withRow(11, ["", "9/5/26", " ", "Donations", 100]), 11), /description is missing/);
    assert.match(errorFor(withRow(11, ["", "9/5/26", "x".repeat(201), "Donations", 100]), 11), /over 200 characters/);
  });

  it("a tab with no header row", () => {
    const result = parse([["Date", "Description"], ["9/1/26", "Something"]]);
    assert.equal(result.rows.length, 0);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].sheetRow, null);
    assert.match(result.errors[0].message, /header row/);
  });

  it("a row that has errors isn't imported, and the others still are", () => {
    const result = parse(withRow(11, ["", "9/5/26", "Family donation", "", 100]));
    assert.equal(result.rows.length, 8);
    assert.ok(!result.rows.some((r) => r.sheetRow === 11));
  });
});

describe("parseLedgerGrid: layout details", () => {
  it("skips blank rows, including one with only a running balance", () => {
    const grid = sheet();
    grid.splice(11, 0, [], ["", "", "", "", "", "", 999], ["  ", null, undefined]);
    const result = parse(grid);
    assert.deepEqual(result.errors, []);
    assert.equal(result.rows.length, 9);
    // The rows after the blank ones keep their own Sheet row numbers.
    assert.equal(result.rows[2].sheetRow, 15);
  });

  it("finds the columns by name, wherever they are", () => {
    const result = parse([
      ["Category", "Outflow", "Inflow", "Description", "Date"],
      ["Dues", "", "12.50", "Dues paid", "9/1/26"],
    ]);
    assert.deepEqual(result.errors, []);
    assert.equal(result.rows[0].cents, 1250);
    assert.equal(result.rows[0].sheetRow, 2);
  });

  it("warns where a running balance starts to differ — once, not on every row after", () => {
    const grid = sheet();
    grid[12] = ["", "9/12/26", "Popcorn supplier", "Fundraising", "", 984.31, 410.25]; // $10 too high from here
    grid[13] = ["", "10/1/26", "Fall Campout payments total", "Fall Campout (Oct)", 3405.9, "", 3816.15];
    grid[14] = ["", "10/14/26", "Fall Campout expenses total", "Fall Campout (Oct)", "", 2790.28, 1015.87]; // agrees again
    const messages = parse(grid).warnings.map((w) => w.message);
    assert.ok(
      messages.includes("Row 13: the Sheet's running balance is $410.25, but the rows add up to $400.25 (a difference of $10.00)."),
      messages.join("\n"),
    );
    assert.ok(!messages.some((m) => m.startsWith("Row 14:")));
    assert.ok(messages.some((m) => m.startsWith("Row 15:") && m.includes("agrees with the rows again")));
  });

  it("refuses a line on row 1000 or past it, where the read stops", () => {
    const grid: Grid = sheet();
    while (grid.length < 1000) grid.push([]);
    grid[999] = ["", "10/26/26", "Late line", "Dues", 5];
    assert.match(errorFor(grid, 1000), /only the first 1,000 rows/);
    const csvLong: Grid = sheet();
    while (csvLong.length < 1200) csvLong.push([]);
    csvLong[1100] = ["", "10/26/26", "Way down", "Dues", 5];
    assert.match(errorFor(csvLong, 1101), /only the first 1,000 rows/);
  });

  it("ignores a checkbox column or a balance filled down to row 1000", () => {
    const grid: Grid = sheet();
    for (let r = grid.length; r < 1000; r++) grid.push(["", "", "", "", "", "", 400.25, false]);
    const result = parse(grid);
    assert.deepEqual(result.errors, []);
    assert.equal(result.rows.length, 9);
  });

  it("warns about dates out of order", () => {
    const grid = sheet();
    grid[12] = ["", "9/2/26", "Popcorn supplier", "Fundraising", "", 984.31, 400.25];
    const warning = parse(grid).warnings.find((w) => w.sheetRow === 13);
    assert.match(warning?.message ?? "", /9\/2\/2026 comes after a later date \(9\/10\/2026 on row 12\)/);
  });

  it("warns when a summary box doesn't match the rows", () => {
    const grid = sheet();
    grid[4] = ["", 1400, 1015.87, 100, 800, 50];
    const result = parse(grid);
    const messages = result.warnings.map((w) => w.message);
    assert.ok(messages.includes("The Sheet's “Total Bank Balance” box shows $1,400.00, but the rows add up to $1,390.87."));
    assert.ok(messages.includes("The Sheet's “Fundraising” box shows $800.00, but the rows add up to $865.87."));
    assert.equal(result.summaryChecks.find((c) => c.label === "Fundraising")?.matches, false);
  });

  it("reads the same rows from a CSV saved from the Sheet", () => {
    const csv = [
      "",
      ",Pack 999 Transactions Ledger",
      ",Beginning 9/1/26",
      ",Total Bank Balance,Available to Spend,Donations,Fundraising,Dues",
      ',"$1,390.87","$1,015.87",$100.00,$865.87,$50.00',
      "",
      "Balances for Events:,Fall Campout (Oct),Spring Trip",
      ",$0.00,$375.00",
      ",Date,Description,Category,Inflow (+),Outflow (-),Running Balance",
      ",9/1/26,Opening balance,Dues,$50.00,,$50.00",
      ",9/5/26,Family donation,Donations,$100.00,,",
      ',9/10/26,Popcorn sale,Fundraising,"$1,234.56",,"$1,384.56"',
      ",9/12/26,Popcorn supplier,Fundraising,,$984.31,$400.25",
      ',10/1/26,Fall Campout payments total,Fall Campout (Oct),"$3,405.90",,"$3,806.15"',
      ',10/14/26,Fall Campout expenses total,Fall Campout (Oct),,"$2,790.28","$1,015.87"',
      ",10/20/26,Close out Fall Campout,Fall Campout (Oct),,$615.62,$400.25",
      ',10/20/26,Fall Campout leftover,Fundraising,$615.62,,"$1,015.87"',
      ',10/25/26,Spring trip deposits,Spring Trip,$375.00,,"$1,390.87"',
    ].join("\r\n");
    const read = parseCsv(`﻿${csv}\r\n`);
    assert.ok(read.ok);
    const fromCsv = parse(read.rows);
    assert.deepEqual(fromCsv.errors, []);
    assert.deepEqual(fromCsv.rows, parse(sheet()).rows);
    assert.equal(fromCsv.fingerprint, parse(sheet()).fingerprint);
    assert.equal(fromCsv.summaryChecks.length, 7);
    assert.ok(fromCsv.summaryChecks.every((c) => c.matches !== false));
  });
});

describe("the fingerprint", () => {
  it("is the same for the same rows", () => {
    assert.equal(parse(sheet()).fingerprint, parse(sheet()).fingerprint);
    assert.match(parse(sheet()).fingerprint, /^[0-9a-f]{64}$/);
  });

  it("changes when one line changes", () => {
    const base = parse(sheet()).fingerprint;
    const grid = sheet();
    grid[10] = ["", "9/5/26", "Family donation", "Donations", 100.01];
    assert.notEqual(parse(grid).fingerprint, base);
    const renamed = sheet();
    renamed[10] = ["", "9/5/26", "Family donation!", "Donations", 100];
    assert.notEqual(parse(renamed).fingerprint, base);
  });

  it("ignores the running balance and summary boxes, which aren't imported", () => {
    const grid = sheet();
    grid[11] = ["", "9/10/2026", "Popcorn sale", "Fundraising", "$1,234.56", "", 9];
    grid[4] = ["", 1, 2, 3, 4, 5];
    assert.equal(parse(grid).fingerprint, parse(sheet()).fingerprint);
  });
});

describe("findTransferPairs", () => {
  const row = (sheetRow: number, direction: "IN" | "OUT", categoryKey: string, cents = 1000, date = "2026-10-20") => ({
    sheetRow,
    date,
    description: `Line ${sheetRow}`,
    category: categoryKey,
    categoryKey,
    direction,
    cents,
  });

  it("pairs an out and an in on the same date, for the same amount, in different categories", () => {
    assert.deepEqual(
      findTransferPairs([row(10, "OUT", "a"), row(11, "IN", "b")]).map((p) => p.id),
      ["10-11"],
    );
  });

  it("doesn't pair within one category, across dates or amounts", () => {
    assert.equal(findTransferPairs([row(10, "OUT", "a"), row(11, "IN", "a")]).length, 0);
    assert.equal(findTransferPairs([row(10, "OUT", "a"), row(11, "IN", "b", 1000, "2026-10-21")]).length, 0);
    assert.equal(findTransferPairs([row(10, "OUT", "a"), row(11, "IN", "b", 1001)]).length, 0);
  });

  it("uses each line once, pairing with the nearest", () => {
    const pairs = findTransferPairs([row(10, "IN", "b"), row(20, "OUT", "a"), row(21, "IN", "c"), row(22, "OUT", "d")]);
    assert.deepEqual(
      pairs.map((p) => p.id),
      ["20-21", "22-10"],
    );
  });
});

describe("import helpers", () => {
  it("defaultImportTab picks the newest scouting-year tab", () => {
    assert.equal(defaultImportTab(["2025-2026", "Fall Campout (Oct)", "2026-2027", "Notes"]), "2026-2027");
    assert.equal(defaultImportTab(["Notes"]), null);
  });

  it("guessLedgerCategoryKind: Event for a ( or a portal event or trip title", () => {
    assert.equal(guessLedgerCategoryKind("Fall Campout (Oct)", []), "EVENT");
    assert.equal(guessLedgerCategoryKind("Spring Trip 2027", ["Spring Trip"]), "EVENT");
    assert.equal(guessLedgerCategoryKind("Fundraising", ["Spring Trip"]), "FUND");
    assert.equal(guessLedgerCategoryKind("Dues", ["Due"]), "FUND", "short titles don't count");
  });

  it("defaultCutoverDate is the day after the last line", () => {
    assert.equal(defaultCutoverDate("2026-10-31"), "2026-11-01");
    assert.equal(defaultCutoverDate("2026-12-31"), "2027-01-01");
    assert.equal(defaultCutoverDate(null), null);
  });
});
