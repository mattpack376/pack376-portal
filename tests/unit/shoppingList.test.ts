/*
 * Pending Awards' Scout Shop shopping list (CSV + PDF): counting by rank and
 * den, the order within a rank, subtotals and the grand total, typed-in names
 * that look like formulas, the filters named in the PDF header, and a list long
 * enough to run onto more pages.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";
import type { PendingAwardItem } from "@/lib/pendingAwardsRules";
import { buildShoppingList, buildShoppingListCsv, shoppingListFilename } from "@/lib/shoppingList";
import { buildShoppingListPdf, shoppingListScopeLine } from "@/lib/shoppingListPdf";

let n = 0;
function item(overrides: Partial<PendingAwardItem> = {}): PendingAwardItem {
  n += 1;
  const scoutId = overrides.scoutId ?? `s${n}`;
  const adventureId = overrides.adventureId ?? `a${n}`;
  return {
    kind: "adventure",
    key: `${scoutId}:${adventureId}`,
    scoutId,
    scoutName: `Scout ${n}`,
    denId: "wolf1",
    denName: "Wolf 1 Den",
    rank: "WOLF",
    adventureId,
    adventureName: "Paws on the Path",
    adventureType: "REQUIRED",
    sortOrder: 2,
    completedDate: "2026-10-09",
    auditStatus: "READY_FOR_AWARD",
    discrepancies: [],
    ...overrides,
  };
}
const rankBadge = (overrides: Partial<PendingAwardItem> = {}) =>
  item({ kind: "rank", adventureId: "rank:WOLF", adventureName: "Wolf rank badge", adventureType: null, sortOrder: -1, ...overrides });

const SCOPE = { year: "2026-2027", filters: { denId: null, type: "all" as const, adventure: null, before: null }, denName: null, heldBack: 0 };
const csvRows = (csv: string) => csv.trim().split(/\r?\n/);

describe("shopping list: counting", () => {
  it("is empty with nothing pending", () => {
    const list = buildShoppingList([]);
    assert.deepEqual(list, { ranks: [], total: 0, denCount: 0 });
    assert.deepEqual(csvRows(buildShoppingListCsv(list)), ["Rank,Item,Type,Quantity,Dens", "Total,,,0,"]);
  });

  it("makes one line per rank + item, split by den", () => {
    const items = [
      item({ denId: "wolf1", denName: "Wolf 1 Den" }),
      item({ denId: "wolf1", denName: "Wolf 1 Den" }),
      item({ denId: "wolf2", denName: "Wolf 2 Den" }),
    ];
    const list = buildShoppingList(items);
    assert.equal(list.ranks.length, 1);
    const [line] = list.ranks[0].lines;
    assert.equal(line.quantity, 3);
    assert.deepEqual(line.dens.map((d) => [d.denName, d.quantity]), [["Wolf 1 Den", 2], ["Wolf 2 Den", 1]]);
    assert.equal(list.denCount, 2);
    assert.equal(csvRows(buildShoppingListCsv(list))[1], "Wolf,Paws on the Path,Required,3,Wolf 1 Den: 2; Wolf 2 Den: 1");
  });

  it("keeps each rank's Bobcat separate, ranks Lion → AOL, badge then Required then Electives A–Z", () => {
    const items = [
      item({ rank: "BEAR", denName: "Bear Den", denId: "bear", adventureName: "Bobcat" }),
      item({ adventureName: "Spirit of the Water", adventureType: "ELECTIVE" }),
      item({ adventureName: "Adventures in Coins", adventureType: "ELECTIVE" }),
      item({ adventureName: "Bobcat" }),
      rankBadge(),
      item({ rank: "LION", denName: "Lion Den", denId: "lion", adventureName: "Fun on the Run" }),
    ];
    const list = buildShoppingList(items);
    assert.deepEqual(list.ranks.map((r) => r.label), ["Lion", "Wolf", "Bear"]);
    assert.deepEqual(list.ranks[1].lines.map((l) => l.itemName), ["Wolf rank badge", "Bobcat", "Adventures in Coins", "Spirit of the Water"]);
    assert.deepEqual(list.ranks.map((r) => r.subtotal), [1, 4, 1]);
    assert.equal(list.total, items.length);

    const rows = csvRows(buildShoppingListCsv(list));
    assert.deepEqual(rows.slice(1, 4), ["Lion,Fun on the Run,Required,1,Lion Den: 1", "Lion subtotal,,,1,", "Wolf,Wolf rank badge,Rank badge,1,Wolf 1 Den: 1"]);
    assert.equal(rows.at(-2), "Bear subtotal,,,1,");
    assert.equal(rows.at(-1), "Total,,,6,");
  });

  it("escapes typed-in names that look like formulas", () => {
    const csv = buildShoppingListCsv(buildShoppingList([item({ adventureName: "=HYPERLINK(1)", denName: "+cmd" }), item({ adventureName: "@Evil" })]));
    assert.match(csv, /,'=HYPERLINK\(1\),/);
    assert.match(csv, /'\+cmd: 1/);
    assert.match(csv, /,'@Evil,/);
  });

  it("names the file after the season, and the den when filtered", () => {
    assert.equal(shoppingListFilename("2026-2027", null, "csv"), "pack376-shopping-list-2026-2027.csv");
    assert.equal(shoppingListFilename("2026-2027", "Wolf 1 Den", "pdf"), "pack376-shopping-list-2026-2027-wolf-1-den.pdf");
    assert.equal(shoppingListFilename("2026-2027", "李", "pdf"), "pack376-shopping-list-2026-2027.pdf");
  });
});

describe("shopping list: PDF", () => {
  it("builds one page with nothing to buy and no checklist", async () => {
    const doc = await PDFDocument.load(await buildShoppingListPdf([], SCOPE, new Date("2026-11-28T15:00:00Z")));
    assert.equal(doc.getPageCount(), 1);
    assert.match(doc.getTitle() ?? "", /Shopping List$/);
  });

  it("adds the hand-out checklist on its own page, even with characters Helvetica can't draw", async () => {
    const items = [item({ scoutName: "Zoë 🏕️ 李" }), rankBadge({ scoutId: "s-x" }), item({ adventureName: "=1+1" })];
    const doc = await PDFDocument.load(await buildShoppingListPdf(items, { ...SCOPE, heldBack: 2 }));
    assert.equal(doc.getPageCount(), 2);
  });

  it("names every filter in the header", () => {
    const line = shoppingListScopeLine(
      { ...SCOPE, denName: "Wolf 1 Den", filters: { denId: "wolf1", type: "adventures", adventure: "Paws on the Path", before: "2026-11-01" } },
      7,
      new Date("2026-11-28T15:00:00Z"),
    );
    assert.equal(line, "Season 2026-2027  •  Wolf 1 Den  •  Adventures only  •  “Paws on the Path”  •  Completed on or before Nov 1, 2026  •  7 to buy  •  Generated November 28, 2026");
    assert.equal(shoppingListScopeLine(SCOPE, 0, new Date("2026-11-28T15:00:00Z")), "Season 2026-2027  •  Every den  •  0 to buy  •  Generated November 28, 2026");
  });

  it("runs a long list and checklist onto more pages without failing", async () => {
    const items = Array.from({ length: 60 }, (_, s) =>
      Array.from({ length: 6 }, (_, a) =>
        item({ scoutId: `long${s}`, scoutName: `Scout ${s}`, adventureId: `adv${a}`, adventureName: `Adventure number ${a} with a fairly long name to wrap` }),
      ),
    ).flat();
    const doc = await PDFDocument.load(await buildShoppingListPdf(items, SCOPE));
    assert.ok(doc.getPageCount() >= 6, `only ${doc.getPageCount()} pages`);
  });
});
