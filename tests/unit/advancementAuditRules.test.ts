import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeMark,
  auditRank,
  auditRecord,
  findRankDiscrepancies,
  rankFromItemId,
  rankItemId,
  rankLastEdited,
  rankProgress,
  findDiscrepancies,
  hasEarnedRank,
  lastEdited,
  programYearWindow,
  summarizeRequirements,
  statusMatchesFilter,
  type AuditRecordInput,
} from "@/lib/advancementAuditRules";
import { buildRequirementTree } from "@/lib/requirementProgress";

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

  describe("requirement checks", () => {
    const tree = buildRequirementTree(
      ["1", "2", "3"].map((id, i) => ({ id, parentId: null, code: id, text: id, pick: null, isGroup: false, sortOrder: i })),
    );
    const check = (requirementId: string, ymd: string | null, completed = true) => ({
      requirementId,
      completed,
      completedDate: ymd ? day(ymd) : null,
      updatedAt: new Date("2026-10-05T12:00:00Z"),
    });
    const withReqs = (checks: ReturnType<typeof check>[], hasAlternative = false) =>
      rec({ requirements: summarizeRequirements(tree, null, hasAlternative, checks) });

    it("all requirements logged before completion is clean", () => {
      const checks = [check("1", "2026-09-20"), check("2", "2026-09-27"), check("3", "2026-10-02")];
      assert.deepEqual(findDiscrepancies(withReqs(checks), today), []);
    });

    it("a legacy completion with nothing logged is not flagged", () => {
      assert.deepEqual(findDiscrepancies(withReqs([]), today), []);
      assert.deepEqual(findDiscrepancies(withReqs([check("1", null, false)]), today), []);
    });

    it("flags a partial log, unless the adventure can be earned another way", () => {
      const partial = [check("1", "2026-09-20")];
      assert.deepEqual(findDiscrepancies(withReqs(partial), today), ["REQUIREMENTS_INCOMPLETE"]);
      assert.deepEqual(findDiscrepancies(withReqs(partial, true), today), []);
    });

    it("flags a requirement dated after completion, and a future one only as future", () => {
      const late = [check("1", "2026-09-20"), check("2", "2026-09-27"), check("3", "2026-10-09")];
      assert.deepEqual(findDiscrepancies(withReqs(late), today), ["REQUIREMENT_AFTER_COMPLETED"]);
      const future = [check("1", "2026-09-20"), check("2", "2026-09-27"), check("3", "2027-10-09")];
      assert.deepEqual(findDiscrepancies(withReqs(future), today), ["FUTURE_REQUIREMENT_DATE"]);
    });

    it("an unchecked adventure ignores its requirement checks", () => {
      const r = rec({ completed: false, completedDate: null, requirements: summarizeRequirements(tree, null, false, [check("1", "2027-01-01")]) });
      assert.equal(auditRecord(r, today), null);
    });

    it("a requirement edit after a mark counts as an edit", () => {
      const reqs = summarizeRequirements(tree, null, false, [check("1", "2026-09-20")]);
      const markedAt = new Date("2026-10-04T00:00:00Z");
      assert.equal(lastEdited(base.updatedAt, reqs).toISOString(), "2026-10-05T12:00:00.000Z");
      const r = rec({ updatedAt: lastEdited(base.updatedAt, reqs), requirements: reqs, mark: { kind: "NEEDS_CORRECTION", recordUpdatedAt: markedAt } });
      assert.equal(activeMark(r), null);
      assert.equal(auditRecord(r, today)?.status, "FLAGGED");
      assert.equal(lastEdited(base.updatedAt, null), base.updatedAt);
    });
  });
});

describe("rank badge", () => {
  const adventures = [
    { id: "r1", type: "REQUIRED" as const },
    { id: "r2", type: "REQUIRED" as const },
    { id: "e1", type: "ELECTIVE" as const },
    { id: "e2", type: "ELECTIVE" as const },
    { id: "e3", type: "ELECTIVE" as const },
  ];
  const done = (adventureId: string, completedDate: string | null, completed = true) => ({ adventureId, completed, completedDate });

  it("is earned on the day the last adventure it needs was done, counting the earliest electives", () => {
    const p = rankProgress(adventures, [
      done("r1", "2026-09-10"),
      done("r2", "2026-10-01"),
      done("e1", "2026-10-20"),
      done("e2", "2026-09-15"),
      done("e3", "2026-09-20"),
    ]);
    assert.equal(p.earned, true);
    assert.equal(p.earnedDate, "2026-10-01", "the third elective (Oct 20) isn't needed");
    assert.deepEqual([p.requiredDone, p.requiredTotal, p.electivesDone, p.electivesRequired], [2, 2, 3, 2]);
  });

  it("isn't earned without every required adventure, and has no date while one it needs is undated", () => {
    assert.equal(rankProgress(adventures, [done("r1", "2026-09-10"), done("e1", "2026-09-15"), done("e2", "2026-09-16")]).earned, false);
    const undated = rankProgress(adventures, [done("r1", null), done("r2", "2026-10-01"), done("e1", "2026-09-15"), done("e2", "2026-09-16")]);
    assert.equal(undated.earned, true);
    assert.equal(undated.earnedDate, null);
    const unchecked = rankProgress(adventures, [done("r1", "2026-09-10"), done("r2", "2026-10-01", false), done("e1", "2026-09-15"), done("e2", "2026-09-16")]);
    assert.equal(unchecked.earned, false, "an unchecked record doesn't count");
    assert.equal(rankProgress(adventures, [done("other", "2026-09-10")]).requiredDone, 0, "another rank's adventure doesn't count");
  });

  const at = new Date("2026-10-05T12:00:00Z");
  const input = (o: Partial<Parameters<typeof auditRank>[0]> = {}) => ({
    earned: true,
    earnedDate: "2026-10-01",
    awardedDate: null,
    updatedAt: at,
    mark: null,
    ...o,
  });

  it("is ready for award once earned, awarded once it has a date, and absent while in progress", () => {
    assert.deepEqual(auditRank(input(), "2026-11-10"), { status: "READY_FOR_AWARD", discrepancies: [] });
    assert.deepEqual(auditRank(input({ awardedDate: "2026-10-10" }), "2026-11-10"), { status: "AWARDED", discrepancies: [] });
    assert.equal(auditRank(input({ earned: false, earnedDate: null }), "2026-11-10"), null);
  });

  it("flags an award that's no longer earned, in the future, or before it was earned", () => {
    assert.deepEqual(findRankDiscrepancies(input({ earned: false, earnedDate: null, awardedDate: "2026-10-10" }), "2026-11-10"), [
      "RANK_NO_LONGER_EARNED",
    ]);
    assert.deepEqual(findRankDiscrepancies(input({ awardedDate: "2026-12-01" }), "2026-11-10"), ["FUTURE_AWARDED_DATE"]);
    assert.deepEqual(findRankDiscrepancies(input({ awardedDate: "2026-09-30" }), "2026-11-10"), ["RANK_AWARDED_BEFORE_EARNED"]);
    assert.deepEqual(findRankDiscrepancies(input({ earnedDate: null }), "2026-11-10"), ["MISSING_COMPLETED_DATE"]);
  });

  it("a mark holds until the badge or one of its adventures is saved again", () => {
    const flagged = input({ earned: false, earnedDate: null, awardedDate: "2026-10-10" });
    const resolved = { ...flagged, mark: { kind: "RESOLVED" as const, recordUpdatedAt: at } };
    assert.equal(auditRank(resolved, "2026-11-10")?.status, "RESOLVED");
    assert.equal(auditRank({ ...resolved, updatedAt: new Date(at.getTime() + 1) }, "2026-11-10")?.status, "FLAGGED");
    assert.equal(
      auditRank({ ...input(), mark: { kind: "NEEDS_CORRECTION", recordUpdatedAt: at } }, "2026-11-10")?.status,
      "NEEDS_CORRECTION",
    );
    assert.equal(rankLastEdited(at, [{ updatedAt: new Date("2026-10-06T00:00:00Z") }]).toISOString(), "2026-10-06T00:00:00.000Z");
    assert.equal(rankLastEdited(at, []).getTime(), at.getTime());
  });

  it("round-trips its item id, refusing anything else", () => {
    assert.equal(rankFromItemId(rankItemId("AOL")), "AOL");
    assert.equal(rankFromItemId("rank:DRAGON"), null);
    assert.equal(rankFromItemId("cmabc123"), null);
  });
});
