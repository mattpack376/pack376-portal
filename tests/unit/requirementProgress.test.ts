import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRequirementTree,
  checkableRequirements,
  isRequirementMet,
  latestDate,
  requirementProgress,
  type RequirementRow,
} from "@/lib/requirementProgress";

const row = (id: string, overrides: Partial<RequirementRow> = {}): RequirementRow => ({
  id,
  parentId: null,
  code: id,
  text: `Requirement ${id}`,
  pick: null,
  isGroup: false,
  sortOrder: Number.parseInt(id, 10) || 0,
  ...overrides,
});
const checked = (...ids: string[]) => new Set(ids);

describe("requirement progress", () => {
  it("a flat list needs every requirement", () => {
    const tree = buildRequirementTree([row("1"), row("2"), row("3")]);
    assert.deepEqual(requirementProgress(tree, null, checked("1", "3")), {
      met: 2,
      needed: 3,
      total: 3,
      allMet: false,
      anyChecked: true,
    });
    assert.equal(requirementProgress(tree, null, checked("1", "2", "3")).allMet, true);
  });

  it("nothing checked is reported as none logged", () => {
    const tree = buildRequirementTree([row("1"), row("2")]);
    const progress = requirementProgress(tree, null, checked());
    assert.equal(progress.anyChecked, false);
    assert.equal(progress.met, 0);
    assert.equal(progress.allMet, false);
  });

  it("an adventure-level pick needs only that many top-level requirements", () => {
    const tree = buildRequirementTree([row("1"), row("2"), row("3"), row("4")]);
    assert.equal(requirementProgress(tree, 2, checked("2")).allMet, false);
    assert.deepEqual(requirementProgress(tree, 2, checked("2", "4")), {
      met: 2,
      needed: 2,
      total: 4,
      allMet: true,
      anyChecked: true,
    });
  });

  it("lettered parts must all be done unless the parent picks", () => {
    const rows = [
      row("1"),
      row("2", { sortOrder: 2 }),
      row("2a", { parentId: "2", sortOrder: 1 }),
      row("2b", { parentId: "2", sortOrder: 2 }),
    ];
    const tree = buildRequirementTree(rows);
    assert.equal(isRequirementMet(tree[1], checked("2a")), false);
    assert.equal(isRequirementMet(tree[1], checked("2a", "2b")), true);

    const picky = buildRequirementTree(rows.map((r) => (r.id === "2" ? { ...r, pick: 1 } : r)));
    assert.equal(isRequirementMet(picky[1], checked("2b")), true);
  });

  it("a 'two of 4-7' group counts once it has two", () => {
    const tree = buildRequirementTree([
      row("1"),
      row("g", { code: "4-7", isGroup: true, pick: 2, sortOrder: 2 }),
      row("4", { parentId: "g", sortOrder: 1 }),
      row("5", { parentId: "g", sortOrder: 2 }),
      row("6", { parentId: "g", sortOrder: 3 }),
      row("7", { parentId: "g", sortOrder: 4 }),
    ]);
    assert.equal(requirementProgress(tree, null, checked("1", "6")).allMet, false);
    assert.equal(requirementProgress(tree, null, checked("1", "5", "7")).allMet, true);
    // Groups have no checkbox; only the leaves do.
    assert.deepEqual(
      checkableRequirements(tree).map((n) => n.code),
      ["1", "4", "5", "6", "7"],
    );
  });

  it("an empty group is never met and an adventure with no requirements is never 'all met'", () => {
    const tree = buildRequirementTree([row("g", { isGroup: true })]);
    assert.equal(isRequirementMet(tree[0], checked("g")), false);
    assert.equal(requirementProgress([], null, checked()).allMet, false);
  });

  it("builds each level in sort order and drops orphans", () => {
    const tree = buildRequirementTree([
      row("3", { sortOrder: 3 }),
      row("1", { sortOrder: 1 }),
      row("x", { parentId: "missing" }),
      row("2", { sortOrder: 2 }),
    ]);
    assert.deepEqual(
      tree.map((n) => n.code),
      ["1", "2", "3"],
    );
  });

  it("latestDate picks the newest YYYY-MM-DD and ignores blanks", () => {
    assert.equal(latestDate(["2026-09-10", null, "2026-10-02", "2026-09-30", undefined]), "2026-10-02");
    assert.equal(latestDate([null, undefined]), null);
  });
});
