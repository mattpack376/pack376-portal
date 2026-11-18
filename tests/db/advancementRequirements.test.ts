/*
 * Requirement checks ride along with Apply Changes on the advancement card:
 * same den check, same rank check, same all-or-nothing transaction and audit
 * entry. A requirement must belong to an adventure of the scout's rank and be
 * a checkable one (not a group or a parent with lettered parts).
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { withTestDatabase } from "../support/db";
import { resetTestState, runAs, type SessionUser } from "../support/context";
import { packFixtures } from "./fixtures/pack";

const db = withTestDatabase("advancement_requirements");
let advancement: typeof import("@/lib/actions/advancement");
let fx: ReturnType<typeof packFixtures>;

before(async () => {
  await db.ready;
  advancement = await import("@/lib/actions/advancement");
  fx = packFixtures(db.prisma);
});

beforeEach(() => resetTestState());

type Changes = Parameters<typeof advancement.applyAdventureChangesAction>[1];
type RequirementChanges = Parameters<typeof advancement.applyAdventureChangesAction>[2];

function apply(user: SessionUser, scoutId: string, changes: unknown, requirementChanges: unknown) {
  return runAs(user, () =>
    advancement.applyAdventureChangesAction(scoutId, changes as Changes, requirementChanges as RequirementChanges),
  );
}

let seq = 0;
async function requirement(adventureId: string, data: { parentId?: string; isGroup?: boolean; pick?: number } = {}) {
  seq += 1;
  return db.prisma.adventureRequirement.create({
    data: {
      adventureId,
      parentId: data.parentId ?? null,
      code: `${seq}`,
      text: `Requirement ${seq}`,
      isGroup: data.isGroup ?? false,
      pick: data.pick ?? null,
      sortOrder: seq,
    },
  });
}

/** A Tiger scout and leader, a Tiger adventure with two requirements and a lettered parent, and a Wolf requirement. */
async function setup() {
  const tigers = await fx.den("TIGER");
  const scout = await fx.scout(tigers.id);
  const leader = await fx.user("DEN", { denIds: [tigers.id] });
  seq += 1;
  const adventure = await fx.adventure("TIGER", `Tiger Bites ${seq}`);
  const r1 = await requirement(adventure.id);
  const r2 = await requirement(adventure.id);
  const parent = await requirement(adventure.id);
  const part = await requirement(adventure.id, { parentId: parent.id });
  const wolfAdventure = await fx.adventure("WOLF");
  const wolfRequirement = await requirement(wolfAdventure.id);
  return { tigers, scout, leader, adventure, r1, r2, parent, part, wolfRequirement };
}

const done = (requirementId: string, completedDate: string | null = "2026-10-02") => ({
  requirementId,
  completed: true,
  completedDate,
});
const undone = (requirementId: string) => ({ requirementId, completed: false, completedDate: null });

async function checksFor(scoutId: string) {
  return db.prisma.requirementRecord.findMany({ where: { scoutId }, orderBy: { requirementId: "asc" } });
}

describe("advancement requirements", () => {
  it("saves requirement checks alongside an adventure change and audits both", async () => {
    const { scout, leader, adventure, r1, r2 } = await setup();
    const result = await apply(
      leader,
      scout.id,
      [{ adventureId: adventure.id, completed: true, completedDate: "2026-10-03", awardedDate: null }],
      [done(r1.id, "2026-10-01"), done(r2.id, "2026-10-03")],
    );
    assert.deepEqual(result, { ok: true });

    const checks = new Map((await checksFor(scout.id)).map((c) => [c.requirementId, c]));
    assert.equal(checks.get(r1.id)?.completed, true);
    assert.equal(checks.get(r1.id)?.completedDate?.toISOString().slice(0, 10), "2026-10-01");
    assert.equal(checks.get(r2.id)?.updatedByUserId, leader.id);

    const audit = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "advancement.update", entityId: scout.id } });
    assert.match(audit.summary, /Updated 1 adventure and 2 requirements/);
    assert.match(JSON.stringify(audit.details), /Tiger Bites \d+ · requirement/);
  });

  it("saves requirement checks on their own, and unchecking keeps the row but clears the date", async () => {
    const { scout, leader, r1 } = await setup();
    assert.deepEqual(await apply(leader, scout.id, [], [done(r1.id)]), { ok: true });
    assert.deepEqual(await apply(leader, scout.id, [], [undone(r1.id)]), { ok: true });
    const [check] = await checksFor(scout.id);
    assert.equal(check.completed, false);
    assert.equal(check.completedDate, null);
  });

  it("unchecking the adventure leaves its requirement checks alone", async () => {
    const { scout, leader, adventure, r1 } = await setup();
    await apply(leader, scout.id, [{ adventureId: adventure.id, completed: true, completedDate: "2026-10-03", awardedDate: null }], [done(r1.id)]);
    await apply(leader, scout.id, [{ adventureId: adventure.id, completed: false, completedDate: null, awardedDate: null }], []);
    const [check] = await checksFor(scout.id);
    assert.equal(check.completed, true);
  });

  it("refuses another rank's requirement, a parent, a group and an unknown id, writing nothing", async () => {
    const { scout, leader, adventure, r1, parent, wolfRequirement } = await setup();
    const group = await requirement(adventure.id, { isGroup: true });
    await requirement(adventure.id, { parentId: group.id });
    const before = await db.prisma.auditLog.count();
    for (const bad of [wolfRequirement.id, parent.id, group.id, "no-such-requirement"]) {
      const result = await apply(leader, scout.id, [], [done(r1.id), done(bad)]);
      assert.equal(result.ok, false, bad);
      assert.match(result.ok ? "" : result.error, /isn't part of this scout's rank/);
    }
    assert.deepEqual(await checksFor(scout.id), []);
    assert.equal(await db.prisma.auditLog.count(), before);
  });

  it("refuses a checked requirement with no date, or a bad one", async () => {
    const { scout, leader, r1 } = await setup();
    for (const bad of [done(r1.id, null), done(r1.id, "2026-02-31"), { requirementId: r1.id, completed: "yes", completedDate: "2026-10-01" }]) {
      const result = await apply(leader, scout.id, [], [bad]);
      assert.equal(result.ok, false, JSON.stringify(bad));
    }
    assert.deepEqual(await checksFor(scout.id), []);
  });

  it("turns away another den's leader and a parent", async () => {
    const { scout, r1 } = await setup();
    const otherDen = await fx.den("TIGER");
    const otherLeader = await fx.user("DEN", { denIds: [otherDen.id] });
    const parentUser = await fx.user("PARENT", { scoutIds: [scout.id] });
    for (const user of [otherLeader, parentUser]) {
      const result = await apply(user, scout.id, [], [done(r1.id)]).catch((e: unknown) => ({ ok: false, error: String(e) }));
      assert.equal((result as { ok: boolean }).ok, false);
    }
    assert.deepEqual(await checksFor(scout.id), []);
  });
});
