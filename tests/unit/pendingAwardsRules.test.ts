import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdvancementAuditRecord } from "@/lib/advancementAuditRules";
import {
  MAX_AWARD_BATCH,
  awardDateProblem,
  completedAfter,
  filterPendingItems,
  groupByAward,
  groupByScout,
  isPendingAward,
  parsePendingAwardFilters,
  readAwardRequest,
  readUndoRequest,
  toPendingItems,
} from "@/lib/pendingAwardsRules";

let n = 0;
function record(overrides: Partial<AdvancementAuditRecord> = {}): AdvancementAuditRecord {
  n += 1;
  return {
    kind: "adventure",
    recordId: `r${n}`,
    scoutId: "s1",
    scoutName: "Avery Adams",
    denId: "d1",
    denName: "Wolf Den",
    rank: "WOLF",
    adventureId: `a${n}`,
    adventureName: `Adventure ${n}`,
    adventureType: "REQUIRED",
    sortOrder: n,
    completed: true,
    completedDate: "2026-10-01",
    awardedDate: null,
    enteredBy: null,
    updatedAt: new Date("2026-10-01T12:00:00Z"),
    status: "READY_FOR_AWARD",
    discrepancies: [],
    mark: null,
    ...overrides,
  };
}

describe("pending awards: what counts as pending", () => {
  it("is completed, dated, and not yet awarded", () => {
    assert.equal(isPendingAward({ completed: true, completedDate: "2026-10-01", awardedDate: null }), true);
    assert.equal(isPendingAward({ completed: true, completedDate: "2026-10-01", awardedDate: "2026-10-05" }), false);
    assert.equal(isPendingAward({ completed: true, completedDate: null, awardedDate: null }), false);
    assert.equal(isPendingAward({ completed: false, completedDate: null, awardedDate: null }), false);
  });

  it("offers ready and resolved records, holds back flagged ones, drops the rest", () => {
    const ready = record();
    const resolved = record({ status: "RESOLVED", discrepancies: ["OUTSIDE_PROGRAM_YEAR"] });
    const flagged = record({ status: "FLAGGED", discrepancies: ["REQUIREMENTS_INCOMPLETE"] });
    const correction = record({ status: "NEEDS_CORRECTION" });
    const awarded = record({ status: "AWARDED", awardedDate: "2026-10-02" });
    const awardedNotDone = record({ completed: false, completedDate: null, awardedDate: "2026-10-02", status: "FLAGGED" });
    const noDate = record({ completedDate: null, status: "FLAGGED", discrepancies: ["MISSING_COMPLETED_DATE"] });

    const { awardable, heldBack } = toPendingItems([ready, resolved, flagged, correction, awarded, awardedNotDone, noDate]);
    assert.deepEqual(awardable.map((i) => i.adventureId).sort(), [ready.adventureId, resolved.adventureId].sort());
    assert.deepEqual(heldBack.map((i) => i.adventureId).sort(), [flagged.adventureId, correction.adventureId].sort());
    assert.equal(awardable[0].key, `${ready.scoutId}:${ready.adventureId}`);
  });

  it("sorts by rank, den, scout and checklist order", () => {
    const items = toPendingItems([
      record({ rank: "BEAR", denName: "Bear Den", scoutName: "Zed", sortOrder: 1 }),
      record({ rank: "WOLF", denName: "Wolf Den", scoutName: "Bea", scoutId: "s2", sortOrder: 5 }),
      record({ rank: "WOLF", denName: "Wolf Den", scoutName: "Bea", scoutId: "s2", sortOrder: 2 }),
      record({ rank: "WOLF", denName: "Wolf Den", scoutName: "Al", sortOrder: 9 }),
    ]).awardable;
    assert.deepEqual(
      items.map((i) => `${i.rank}/${i.scoutName}/${i.sortOrder}`),
      ["WOLF/Al/9", "WOLF/Bea/2", "WOLF/Bea/5", "BEAR/Zed/1"],
    );
  });
});

describe("pending awards: filters and grouping", () => {
  const items = toPendingItems([
    record({ denId: "d1", scoutId: "s1", scoutName: "Avery", adventureName: "Bobcat", completedDate: "2026-09-20" }),
    record({ denId: "d1", scoutId: "s1", scoutName: "Avery", adventureName: "Paws for Water", completedDate: "2026-10-20" }),
    record({ denId: "d1", scoutId: "s2", scoutName: "Blake", adventureName: "Bobcat", completedDate: "2026-10-01" }),
    record({ denId: "d2", denName: "Bear Den", rank: "BEAR", scoutId: "s3", scoutName: "Casey", adventureName: "Bobcat", completedDate: "2026-09-25" }),
  ]).awardable;

  it("filters by den, exact adventure name and completed-on-or-before", () => {
    const f = (o: Partial<ReturnType<typeof parsePendingAwardFilters>>) =>
      filterPendingItems(items, { denId: null, type: "all", adventure: null, before: null, ...o }).length;
    assert.equal(f({}), 4);
    assert.equal(f({ denId: "d1" }), 3);
    assert.equal(f({ adventure: "Bobcat" }), 3, "every rank's Bobcat");
    assert.equal(f({ adventure: "Bob" }), 0, "an exact name, not a search");
    assert.equal(f({ before: "2026-10-01" }), 3, "on the day counts");
    assert.equal(f({ denId: "d1", adventure: "Bobcat", before: "2026-09-30" }), 1);
    assert.equal(f({ denId: "someone-elses-den" }), 0);
  });

  it("reads filters from the URL, dropping junk", () => {
    assert.deepEqual(parsePendingAwardFilters({ denId: "d1", type: "ranks", adventure: " Bobcat ", before: "2026-10-01" }), {
      denId: "d1",
      type: "ranks",
      adventure: "Bobcat",
      before: "2026-10-01",
    });
    assert.deepEqual(
      parsePendingAwardFilters({ denId: "x".repeat(65), type: "badges", adventure: "", before: "2026-02-31" }),
      { denId: null, type: "all", adventure: null, before: null },
    );
    assert.deepEqual(parsePendingAwardFilters({ denId: ["d1", "d2"] }).denId, "d1");
    assert.equal(parsePendingAwardFilters({ type: "constructor" }).type, "all", "own keys only");
  });

  it("groups by den and scout", () => {
    const dens = groupByScout(items);
    assert.deepEqual(
      dens.map((d) => [d.denId, d.count, d.scouts.map((s) => `${s.scoutName}:${s.items.length}`)]),
      [
        ["d1", 3, ["Avery:2", "Blake:1"]],
        ["d2", 1, ["Casey:1"]],
      ],
    );
  });

  it("groups by award per rank, with how many of each", () => {
    const groups = groupByAward(items);
    assert.deepEqual(
      groups.map((g) => [g.rank, g.adventureName, g.items.length]),
      [
        ["WOLF", "Bobcat", 2],
        ["WOLF", "Paws for Water", 1],
        ["BEAR", "Bobcat", 1],
      ],
    );
  });
});

describe("pending awards: the award date", () => {
  const today = "2026-11-25";
  it("must be a real date, today or earlier", () => {
    assert.equal(awardDateProblem("2026-11-25", today), null);
    assert.equal(awardDateProblem("2026-01-02", today), null);
    assert.match(awardDateProblem("2026-11-26", today) ?? "", /future/);
    assert.match(awardDateProblem("2026-02-30", today) ?? "", /real date/);
    assert.match(awardDateProblem("", today) ?? "", /Enter the date/);
    assert.match(awardDateProblem(20261101, today) ?? "", /Enter the date/);
  });

  it("lists items completed after it, to skip", () => {
    const list = [{ completedDate: "2026-10-01" }, { completedDate: "2026-10-02" }, { completedDate: null }];
    assert.deepEqual(completedAfter(list, "2026-10-01"), [{ completedDate: "2026-10-02" }]);
    assert.deepEqual(completedAfter(list, "2026-10-02"), []);
  });
});

describe("pending awards: reading a bulk award request", () => {
  const today = "2026-11-25";
  const item = (scoutId: string, adventureId: string) => ({ scoutId, adventureId });

  it("accepts pairs, collapses repeats, and sorts the scouts to lock", () => {
    const read = readAwardRequest([item("s2", "a1"), item("s1", "a1"), item("s2", "a1"), item("s2", "a2")], "2026-11-20", today);
    assert.ok(read.ok);
    assert.equal(read.request.items.length, 3);
    assert.deepEqual(read.request.scoutIds, ["s1", "s2"]);
    assert.equal(read.request.awardedDate, "2026-11-20");
  });

  it("refuses a future or invalid date, an empty or oversized batch, and malformed entries", () => {
    const refusals: [unknown, unknown, RegExp][] = [
      [[item("s1", "a1")], "2026-11-26", /future/],
      [[item("s1", "a1")], "2026-13-01", /real date/],
      [[item("s1", "a1")], null, /Enter the date/],
      [[], "2026-11-20", /Tick at least one/],
      [Array.from({ length: MAX_AWARD_BATCH + 1 }, (_, i) => item("s1", `a${i}`)), "2026-11-20", /too many at once/],
      ["not an array", "2026-11-20", /couldn't be read/],
      [[null], "2026-11-20", /couldn't be read/],
      [[["s1", "a1"]], "2026-11-20", /couldn't be read/],
      [[{ scoutId: 1, adventureId: "a1" }], "2026-11-20", /couldn't be read/],
      [[{ scoutId: "s1", adventureId: "" }], "2026-11-20", /couldn't be read/],
      [[{ scoutId: "x".repeat(65), adventureId: "a1" }], "2026-11-20", /couldn't be read/],
    ];
    for (const [items, date, message] of refusals) {
      const read = readAwardRequest(items, date, today);
      assert.equal(read.ok, false, JSON.stringify([items, date]).slice(0, 80));
      assert.match(read.ok ? "" : read.error, message);
    }
    // Exactly at the cap is fine.
    assert.ok(readAwardRequest(Array.from({ length: MAX_AWARD_BATCH }, (_, i) => item("s1", `a${i}`)), "2026-11-20", today).ok);
  });

  it("reads an undo token, refusing anything malformed", () => {
    const at = "2026-11-25T15:00:00.123Z";
    const read = readUndoRequest({ awardedDate: "2026-11-20", items: [{ scoutId: "s1", adventureId: "a1", updatedAt: at }] });
    assert.ok(read.ok);
    assert.equal(read.request.items[0].updatedAt.toISOString(), at);
    for (const bad of [
      null,
      [],
      { awardedDate: "nope", items: [{ scoutId: "s1", adventureId: "a1", updatedAt: at }] },
      { awardedDate: "2026-11-20", items: [] },
      { awardedDate: "2026-11-20", items: [{ scoutId: "s1", adventureId: "a1", updatedAt: "yesterday" }] },
      { awardedDate: "2026-11-20", items: [{ scoutId: "s1", adventureId: "a1" }] },
      { awardedDate: "2026-11-20", items: Array.from({ length: MAX_AWARD_BATCH + 1 }, () => ({ scoutId: "s1", adventureId: "a1", updatedAt: at })) },
    ]) {
      assert.equal(readUndoRequest(bad).ok, false, JSON.stringify(bad)?.slice(0, 80));
    }
  });
});

describe("pending awards: rank badges", () => {
  const items = toPendingItems([
    record({ scoutId: "s1", adventureName: "Bobcat", completedDate: "2026-10-01" }),
    record({
      kind: "rank",
      scoutId: "s1",
      adventureId: "rank:WOLF",
      adventureName: "Wolf rank badge",
      adventureType: null,
      sortOrder: -1,
      completedDate: "2026-10-05",
    }),
    record({
      kind: "rank",
      scoutId: "s2",
      scoutName: "Blake",
      adventureId: "rank:WOLF",
      adventureName: "Wolf rank badge",
      adventureType: null,
      sortOrder: -1,
      completedDate: "2026-10-07",
    }),
  ]).awardable;

  it("keys a badge by scout and rank, and lists it first under its scout", () => {
    const avery = items.filter((i) => i.scoutId === "s1");
    assert.equal(avery.length, 2);
    assert.equal(avery[0].key, "s1:rank:WOLF");
    assert.equal(avery[0].kind, "rank");
    assert.equal(avery[1].adventureName, "Bobcat");
  });

  it("filters by award type", () => {
    const f = (type: "all" | "adventures" | "ranks") =>
      filterPendingItems(items, { denId: null, type, adventure: null, before: null }).length;
    assert.equal(f("all"), 3);
    assert.equal(f("adventures"), 1);
    assert.equal(f("ranks"), 2);
  });

  it("groups every scout's badge into one Scout Shop line", () => {
    const groups = groupByAward(items);
    assert.equal(groups[0].adventureName, "Wolf rank badge", "the badge comes first");
    assert.equal(groups[0].items.length, 2);
    assert.equal(groups[0].adventureType, null);
  });

  it("accepts rank items in an award request", () => {
    const read = readAwardRequest([{ scoutId: "s1", adventureId: "rank:WOLF" }], "2026-10-10", "2026-11-01");
    assert.ok(read.ok);
    assert.deepEqual(read.ok && read.request.items, [{ scoutId: "s1", adventureId: "rank:WOLF" }]);
  });
});
