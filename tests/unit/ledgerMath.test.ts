import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareLedgerEntries,
  isInScoutingYear,
  ledgerCategoryNameKey,
  ledgerScoutingYears,
  parseLedgerScoutingYear,
  scoutingYearOf,
  scoutingYearRange,
  signedCents,
  sortLedgerEntries,
  summarizeLedger,
  withRunningBalance,
  type LedgerMathCategory,
  type LedgerMathEntry,
} from "@/lib/ledgerMath";

/** A stored ledger date (date-only, UTC midnight). */
const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

let sequence = 0;
/** An invented ledger line; nothing here is real pack data. */
function line(overrides: Partial<LedgerMathEntry> & { entryDate: Date }): LedgerMathEntry {
  sequence += 1;
  return {
    id: `e${String(sequence).padStart(3, "0")}`,
    importRowNumber: null,
    createdAt: new Date(Date.UTC(2026, 9, 1, 12, 0, sequence)),
    direction: "IN",
    amountCents: 1000,
    categoryId: "general",
    transferId: null,
    ...overrides,
  };
}

const categories: LedgerMathCategory[] = [
  { id: "general", name: "General Fund", kind: "FUND", sortOrder: 0, archived: false },
  { id: "fundraising", name: "Fundraising", kind: "FUND", sortOrder: 20, archived: false },
  { id: "dues", name: "Dues", kind: "FUND", sortOrder: 10, archived: false },
  { id: "campout", name: "Fall Campout", kind: "EVENT", sortOrder: 30, archived: false },
  { id: "derby", name: "Derby", kind: "EVENT", sortOrder: 40, archived: false },
];

describe("ledger order", () => {
  it("sorts by date, then Sheet row, then when it was entered", () => {
    const typedLater = line({ entryDate: day("2026-10-05"), createdAt: new Date("2026-10-06T10:00:00Z") });
    const typedEarlier = line({ entryDate: day("2026-10-05"), createdAt: new Date("2026-10-05T10:00:00Z") });
    const sheetRow12 = line({ entryDate: day("2026-10-05"), importRowNumber: 12, createdAt: new Date("2026-11-01T00:00:00Z") });
    const sheetRow11 = line({ entryDate: day("2026-10-05"), importRowNumber: 11, createdAt: new Date("2026-11-01T00:00:00Z") });
    const dayBefore = line({ entryDate: day("2026-10-04"), createdAt: new Date("2026-12-01T00:00:00Z") });

    const sorted = sortLedgerEntries([typedLater, sheetRow12, typedEarlier, dayBefore, sheetRow11]);
    assert.deepEqual(
      sorted.map((e) => e.id),
      [dayBefore.id, sheetRow11.id, sheetRow12.id, typedEarlier.id, typedLater.id],
    );
  });

  it("breaks an exact tie by id, so the order never shuffles", () => {
    const at = new Date("2026-10-05T10:00:00Z");
    const a = { ...line({ entryDate: day("2026-10-05"), createdAt: at }), id: "a" };
    const b = { ...line({ entryDate: day("2026-10-05"), createdAt: at }), id: "b" };
    assert.ok(compareLedgerEntries(a, b) < 0);
    assert.ok(compareLedgerEntries(b, a) > 0);
    assert.equal(compareLedgerEntries(a, a), 0);
  });

  it("doesn't change the array it was given", () => {
    const later = line({ entryDate: day("2026-10-06") });
    const earlier = line({ entryDate: day("2026-10-05") });
    const input = [later, earlier];
    sortLedgerEntries(input);
    assert.deepEqual(input, [later, earlier]);
  });
});

describe("running balance", () => {
  it("adds money in and takes away money out, oldest first", () => {
    const rows = withRunningBalance([
      line({ entryDate: day("2026-10-03"), direction: "OUT", amountCents: 2550 }),
      line({ entryDate: day("2026-10-01"), direction: "IN", amountCents: 10000 }),
      line({ entryDate: day("2026-10-02"), direction: "IN", amountCents: 499 }),
    ]);
    assert.deepEqual(
      rows.map((r) => [r.amountCents, r.balanceCents]),
      [
        [10000, 10000],
        [499, 10499],
        [2550, 7949],
      ],
    );
  });

  it("can go below zero", () => {
    const rows = withRunningBalance([line({ entryDate: day("2026-10-01"), direction: "OUT", amountCents: 1 })]);
    assert.equal(rows[0].balanceCents, -1);
  });

  it("signs each line", () => {
    assert.equal(signedCents({ direction: "IN", amountCents: 1234 }), 1234);
    assert.equal(signedCents({ direction: "OUT", amountCents: 1234 }), -1234);
  });
});

describe("summarizeLedger", () => {
  const closeOut = "transfer-1";
  const entries = [
    line({ entryDate: day("2026-09-10"), categoryId: "dues", amountCents: 40000 }),
    line({ entryDate: day("2026-09-12"), categoryId: "fundraising", amountCents: 42000 }),
    line({ entryDate: day("2026-09-20"), categoryId: "campout", amountCents: 300000 }),
    line({ entryDate: day("2026-10-05"), categoryId: "campout", direction: "OUT", amountCents: 240000 }),
    // The campout is over: what's left moves to Fundraising.
    line({ entryDate: day("2026-10-20"), categoryId: "campout", direction: "OUT", amountCents: 60000, transferId: closeOut }),
    line({ entryDate: day("2026-10-20"), categoryId: "fundraising", direction: "IN", amountCents: 60000, transferId: closeOut }),
    line({ entryDate: day("2026-10-25"), categoryId: "derby", amountCents: 5000 }),
    line({ entryDate: day("2026-10-26"), categoryId: "general", direction: "OUT", amountCents: 1500 }),
  ];

  it("counts moves between categories in the categories' balances", () => {
    const summary = summarizeLedger(entries, categories);
    const net = Object.fromEntries(summary.categories.map((c) => [c.id, c.netCents]));
    assert.equal(net.campout, 0, "the closed-out event comes to $0");
    assert.equal(net.fundraising, 102000, "Fundraising gains what was moved in");
    assert.equal(net.dues, 40000);
    assert.equal(net.general, -1500);
    const campout = summary.categories.find((c) => c.id === "campout");
    assert.deepEqual([campout?.inCents, campout?.outCents], [300000, 300000]);
  });

  it("leaves those moves out of the money in and out totals, and out of the bank balance", () => {
    const summary = summarizeLedger(entries, categories);
    assert.equal(summary.bankBalanceCents, 40000 + 42000 + 300000 - 240000 + 5000 - 1500);
    assert.equal(summary.periodInCents, 40000 + 42000 + 300000 + 5000);
    assert.equal(summary.periodOutCents, 240000 + 1500);
  });

  it("sets aside only positive event balances from Available to Spend", () => {
    const withOverspent = [...entries, line({ entryDate: day("2026-10-27"), categoryId: "derby", direction: "OUT", amountCents: 9000 })];
    const summary = summarizeLedger(entries, categories);
    assert.equal(summary.availableToSpendCents, summary.bankBalanceCents - 5000, "the derby's $50 is held");

    const overspent = summarizeLedger(withOverspent, categories);
    assert.equal(overspent.categories.find((c) => c.id === "derby")?.netCents, -4000);
    assert.equal(overspent.availableToSpendCents, overspent.bankBalanceCents, "a negative event balance isn't added back");
  });

  it("totals one period, while balances stay all time", () => {
    const summary = summarizeLedger(entries, categories, { from: day("2026-10-01"), to: day("2026-10-31") });
    assert.equal(summary.periodInCents, 5000);
    assert.equal(summary.periodOutCents, 240000 + 1500);
    assert.equal(summary.bankBalanceCents, summarizeLedger(entries, categories).bankBalanceCents);
  });

  it("lists categories by order, then name, including ones with no lines", () => {
    const summary = summarizeLedger([], [...categories, { id: "aaa", name: "Archived Fund", kind: "FUND", sortOrder: 0, archived: true }]);
    assert.deepEqual(
      summary.categories.map((c) => c.id),
      ["aaa", "general", "dues", "fundraising", "campout", "derby"],
    );
    assert.ok(summary.categories.every((c) => c.netCents === 0));
    assert.equal(summary.bankBalanceCents, 0);
    assert.equal(summary.availableToSpendCents, 0);
  });

  it("still counts a line whose category isn't listed toward the bank balance", () => {
    const summary = summarizeLedger([line({ entryDate: day("2026-10-01"), categoryId: "gone", amountCents: 700 })], categories);
    assert.equal(summary.bankBalanceCents, 700);
  });
});

describe("scouting years", () => {
  it("run September 1 through August 31", () => {
    assert.equal(scoutingYearOf(day("2026-09-01")), "2026-2027");
    assert.equal(scoutingYearOf(day("2026-08-31")), "2025-2026");
    assert.equal(scoutingYearOf(day("2026-12-31")), "2026-2027");
    assert.equal(scoutingYearOf(day("2027-01-01")), "2026-2027");
    assert.equal(scoutingYearOf(day("2027-08-31")), "2026-2027");
  });

  it("gives each year's first and last day", () => {
    const range = scoutingYearRange("2026-2027");
    assert.equal(range.from.toISOString(), "2026-09-01T00:00:00.000Z");
    assert.equal(range.to.toISOString(), "2027-08-31T00:00:00.000Z");
    assert.ok(isInScoutingYear(day("2027-08-31"), "2026-2027"));
    assert.ok(!isInScoutingYear(day("2027-09-01"), "2026-2027"));
    assert.throws(() => scoutingYearRange("2026"));
  });

  it("parses only real year labels", () => {
    assert.equal(parseLedgerScoutingYear("2026-2027"), "2026-2027");
    assert.equal(parseLedgerScoutingYear(" 2026-2027 "), "2026-2027");
    assert.equal(parseLedgerScoutingYear("2026-2028"), null);
    assert.equal(parseLedgerScoutingYear("1999-2000"), null);
    assert.equal(parseLedgerScoutingYear("all"), null);
    assert.equal(parseLedgerScoutingYear(undefined), null);
  });

  it("lists every year with a line plus the current one, newest first", () => {
    assert.deepEqual(ledgerScoutingYears([day("2024-10-01"), day("2025-03-01"), day("2024-09-30")], day("2026-11-02")), [
      "2026-2027",
      "2024-2025",
    ]);
  });
});

describe("category names", () => {
  it("match ignoring case and extra spaces", () => {
    assert.equal(ledgerCategoryNameKey("  Fall   Campout "), "fall campout");
    assert.equal(ledgerCategoryNameKey("GENERAL FUND"), ledgerCategoryNameKey("General Fund"));
  });
});
