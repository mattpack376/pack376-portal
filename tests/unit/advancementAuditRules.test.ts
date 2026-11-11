import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeMark,
  auditRecord,
  findDiscrepancies,
  hasEarnedRank,
  programYearWindow,
  statusMatchesFilter,
  type AuditRecordInput,
} from "@/lib/advancementAuditRules";

/** A stored date-only value (UTC midnight). */
const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const today = day("2026-11-10");

const base: AuditRecordInput = {
  completed: true,
  completedDate: day("2026-10-02"),
  awardedDate: null,
  updatedAt: new Date("2026-10-03T01:00:00Z"),
  scoutingYear: "2026-2027",
  mark: null,
};
const rec = (overrides: Partial<AuditRecordInput>) => ({ ...base, ...overrides });

describe("advancement audit checks", () => {
  it("a clean, unawarded record is ready for award", () => {
    assert.deepEqual(auditRecord(base, today), { status: "READY_FOR_AWARD", discrepancies: [] });
  });

  it("a clean, awarded record is awarded", () => {
    assert.equal(auditRecord(rec({ awardedDate: day("2026-10-30") }), today)?.status, "AWARDED");
  });

  it("an empty, unchecked record isn't audited at all", () => {
    assert.equal(auditRecord(rec({ completed: false, completedDate: null }), today), null);
  });

  it("flags each kind of bad date", () => {
    assert.deepEqual(findDiscrepancies(rec({ completedDate: null }), today), ["MISSING_COMPLETED_DATE"]);
    assert.deepEqual(findDiscrepancies(rec({ completedDate: day("2026-12-01") }), today), ["FUTURE_COMPLETED_DATE"]);
    assert.deepEqual(findDiscrepancies(rec({ awardedDate: day("2026-11-11") }), today), ["FUTURE_AWARDED_DATE"]);
    assert.deepEqual(findDiscrepancies(rec({ awardedDate: day("2026-10-01") }), today), ["AWARDED_BEFORE_COMPLETED"]);
    assert.deepEqual(findDiscrepancies(rec({ completedDate: day("2026-05-31") }), today), ["OUTSIDE_PROGRAM_YEAR"]);
    assert.deepEqual(
      findDiscrepancies(rec({ completed: false, completedDate: null, awardedDate: day("2026-10-01") }), today),
      ["AWARDED_NOT_COMPLETED"],
    );
  });

  it("an award on the completion day itself is fine", () => {
    assert.deepEqual(findDiscrepancies(rec({ awardedDate: day("2026-10-02") }), today), []);
  });

  it("the scouting year runs June 1 to August 31", () => {
    assert.deepEqual(programYearWindow("2026-2027"), { start: day("2026-06-01"), end: day("2027-08-31") });
    assert.equal(programYearWindow("bad"), null);
    assert.deepEqual(findDiscrepancies(rec({ completedDate: day("2026-06-01") }), today), []);
  });

  it("a failed check is flagged until an Admin resolves it", () => {
    const bad = rec({ completedDate: null });
    assert.equal(auditRecord(bad, today)?.status, "FLAGGED");
    const resolved = { ...bad, mark: { kind: "RESOLVED" as const, recordUpdatedAt: bad.updatedAt } };
    assert.equal(auditRecord(resolved, today)?.status, "RESOLVED");
  });

  it("a mark stops counting once the record is edited", () => {
    const flagged = rec({ mark: { kind: "NEEDS_CORRECTION", recordUpdatedAt: base.updatedAt } });
    assert.equal(auditRecord(flagged, today)?.status, "NEEDS_CORRECTION");
    const edited = { ...flagged, updatedAt: new Date("2026-11-01T00:00:00Z") };
    assert.equal(activeMark(edited), null);
    assert.equal(auditRecord(edited, today)?.status, "READY_FOR_AWARD");
  });

  it("a resolved mark on a record that's since clean is ignored", () => {
    const clean = rec({ mark: { kind: "RESOLVED", recordUpdatedAt: base.updatedAt } });
    assert.equal(auditRecord(clean, today)?.status, "READY_FOR_AWARD");
  });

  it("the review filter covers flagged and needs-correction", () => {
    assert.ok(statusMatchesFilter("FLAGGED", "review"));
    assert.ok(statusMatchesFilter("NEEDS_CORRECTION", "review"));
    assert.ok(!statusMatchesFilter("RESOLVED", "review"));
    assert.ok(statusMatchesFilter("AWARDED", "all"));
  });

  it("a rank is earned with every required adventure and two electives", () => {
    const adventures = [{ type: "REQUIRED" as const }, { type: "REQUIRED" as const }, { type: "ELECTIVE" as const }];
    assert.ok(hasEarnedRank(adventures, ["REQUIRED", "REQUIRED", "ELECTIVE", "ELECTIVE"]));
    assert.ok(!hasEarnedRank(adventures, ["REQUIRED", "REQUIRED", "ELECTIVE"]));
    assert.ok(!hasEarnedRank(adventures, ["REQUIRED", "ELECTIVE", "ELECTIVE"]));
    assert.ok(!hasEarnedRank([], []));
  });
});
