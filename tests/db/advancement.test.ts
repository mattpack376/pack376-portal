/*
 * F8: Apply Changes on a scout's advancement card. Every adventure has to
 * belong to the scout's rank, every field is checked at runtime, a batch is
 * all-or-nothing, and the den check still turns away other dens' leaders —
 * including when the scout is moved while an Apply is in flight.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { openTransaction, waitForLockWait, withTestDatabase } from "../support/db";
import { asAnonymous, resetTestState, runAs, settle, type SessionUser } from "../support/context";
import { packFixtures, waitForLockWaiters } from "./fixtures/pack";

const db = withTestDatabase("advancement");
let advancement: typeof import("@/lib/actions/advancement");
let fx: ReturnType<typeof packFixtures>;
let admin: SessionUser;

before(async () => {
  await db.ready;
  advancement = await import("@/lib/actions/advancement");
  fx = packFixtures(db.prisma);
  admin = await fx.user("ADMIN");
});

beforeEach(() => resetTestState());

const WRONG_RANK = /isn't part of this scout's rank/;
const UNREADABLE = /couldn't be read/;

/** A Tiger in a Tiger den with three Tiger adventures, plus a Wolf den and a Wolf adventure. */
async function tigerScout() {
  const tigers = await fx.den("TIGER");
  const wolves = await fx.den("WOLF");
  const scout = await fx.scout(tigers.id);
  const [a1, a2, a3] = [await fx.adventure("TIGER"), await fx.adventure("TIGER"), await fx.adventure("TIGER")];
  const wolfAdventure = await fx.adventure("WOLF");
  const tigerLeader = await fx.user("DEN", { denIds: [tigers.id] });
  const wolfLeader = await fx.user("DEN", { denIds: [wolves.id] });
  return { tigers, wolves, scout, a1, a2, a3, wolfAdventure, tigerLeader, wolfLeader };
}

function apply(user: SessionUser, scoutId: unknown, changes: unknown) {
  return runAs(user, () =>
    advancement.applyAdventureChangesAction(scoutId as string, changes as Parameters<typeof advancement.applyAdventureChangesAction>[1]),
  );
}

const complete = (adventureId: string, completedDate = "2026-09-10", awardedDate: string | null = null) => ({
  adventureId,
  completed: true,
  completedDate,
  awardedDate,
});
const uncheck = (adventureId: string) => ({ adventureId, completed: false, completedDate: null, awardedDate: null });

async function recordsFor(scoutId: string) {
  return db.prisma.advancementRecord.findMany({ where: { scoutId }, orderBy: { adventureId: "asc" } });
}

async function writeCounts() {
  const [records, audits] = await Promise.all([db.prisma.advancementRecord.count(), db.prisma.auditLog.count()]);
  return { records, audits };
}

describe("advancement: what an Apply may contain", () => {
  it("applies mixed completion, award and uncheck edits together", async () => {
    const { scout, a1, a2, a3, tigerLeader } = await tigerScout();
    await db.prisma.advancementRecord.create({
      data: { scoutId: scout.id, adventureId: a3.id, completed: true, completedDate: new Date("2026-08-01") },
    });

    const result = await apply(tigerLeader, scout.id, [
      complete(a1.id, "2026-09-10"),
      complete(a2.id, "2026-09-12", "2026-10-01"),
      uncheck(a3.id),
    ]);
    assert.deepEqual(result, { ok: true });

    const byId = new Map((await recordsFor(scout.id)).map((r) => [r.adventureId, r]));
    assert.equal(byId.get(a1.id)?.completed, true);
    assert.equal(byId.get(a1.id)?.completedDate?.toISOString().slice(0, 10), "2026-09-10");
    assert.equal(byId.get(a2.id)?.awardedDate?.toISOString().slice(0, 10), "2026-10-01");
    assert.equal(byId.get(a3.id)?.completed, false);
    assert.equal(byId.get(a3.id)?.completedDate, null);
    assert.equal(byId.get(a1.id)?.updatedByUserId, tigerLeader.id);

    const audit = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "advancement.update", entityId: scout.id } });
    assert.match(audit.summary, /Updated 3 adventures/);
  });

  it("refuses another rank's adventure, or one that doesn't exist, and writes nothing", async () => {
    const { scout, a1, wolfAdventure, tigerLeader } = await tigerScout();
    const counts = await writeCounts();
    for (const changes of [
      [complete(wolfAdventure.id)],
      [complete(a1.id), complete(wolfAdventure.id)],
      [complete(a1.id), complete("no-such-adventure")],
      [uncheck(wolfAdventure.id)],
    ]) {
      const result = await apply(tigerLeader, scout.id, changes);
      assert.equal(result.ok, false);
      assert.match(result.ok ? "" : result.error, WRONG_RANK, JSON.stringify(changes));
    }
    assert.deepEqual(await writeCounts(), counts);
    assert.deepEqual(await recordsFor(scout.id), []);
  });

  it("collapses identical repeats, and refuses repeats that disagree without writing either", async () => {
    const { scout, a1, a2, tigerLeader } = await tigerScout();
    const counts = await writeCounts();
    for (const changes of [
      [complete(a1.id), uncheck(a1.id)],
      [complete(a1.id, "2026-09-10"), complete(a1.id, "2026-09-11")],
      [complete(a1.id, "2026-09-10", null), complete(a1.id, "2026-09-10", "2026-10-01")],
      [complete(a2.id), uncheck(a1.id), complete(a1.id)],
    ]) {
      const result = await apply(tigerLeader, scout.id, changes);
      assert.equal(result.ok, false);
      assert.match(result.ok ? "" : result.error, /changed twice in one save/, JSON.stringify(changes));
    }
    assert.deepEqual(await writeCounts(), counts);

    assert.deepEqual(await apply(tigerLeader, scout.id, [complete(a1.id), complete(a1.id), complete(a1.id)]), { ok: true });
    const records = await recordsFor(scout.id);
    assert.equal(records.length, 1);
    assert.equal(records[0].completed, true);
  });

  it("checks every field's runtime type and value, refusing the whole batch", async () => {
    const { scout, a1, tigerLeader } = await tigerScout();
    const counts = await writeCounts();
    const refusals: [unknown, RegExp][] = [
      ["not an array", UNREADABLE],
      [{ 0: complete(a1.id), length: 1 }, UNREADABLE],
      [null, UNREADABLE],
      [[null], UNREADABLE],
      [[[a1.id, true]], UNREADABLE],
      [[{ ...complete(a1.id), completed: "true" }], UNREADABLE],
      [[{ ...complete(a1.id), completed: 1 }], UNREADABLE],
      [[{ ...complete(a1.id), adventureId: 42 }], UNREADABLE],
      [[{ ...complete(a1.id), adventureId: "" }], UNREADABLE],
      [[{ ...complete(a1.id), adventureId: "x".repeat(65) }], UNREADABLE],
      [[{ ...complete(a1.id), completedDate: 20260910 }], UNREADABLE],
      [[{ ...uncheck(a1.id), awardedDate: { toString: "2026-10-01" } }], UNREADABLE],
      [Array.from({ length: 201 }, () => complete(a1.id)), UNREADABLE],
      [[complete(a1.id, "2026-02-31")], /date isn't valid/],
      [[{ ...uncheck(a1.id), completedDate: "2026-13-01" }], /date isn't valid/],
      [[complete(a1.id, "")], /completion date is required/],
      [[{ adventureId: a1.id, completed: true, completedDate: null, awardedDate: null }], /completion date is required/],
      [[complete(a1.id, "2026-10-02", "2026-10-01")], /award date can't be before/],
    ];
    for (const [changes, message] of refusals) {
      const result = await apply(tigerLeader, scout.id, changes);
      assert.equal(result.ok, false, JSON.stringify(changes)?.slice(0, 80));
      assert.match(result.ok ? "" : result.error, message, JSON.stringify(changes)?.slice(0, 80));
    }
    for (const badScoutId of [42, null, "", "x".repeat(65), "no-such-scout"]) {
      const result = await apply(tigerLeader, badScoutId, [complete(a1.id)]);
      assert.deepEqual(result, { ok: false, error: "Scout not found." });
    }
    assert.deepEqual(await writeCounts(), counts);
  });

  it("writes none of a batch when the database fails partway through it", async (t) => {
    const { scout, a1, a2, tigerLeader } = await tigerScout();
    await db.pool.query(`
      CREATE OR REPLACE FUNCTION test_fail_record_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."adventureId" = '${a2.id}' THEN RAISE EXCEPTION 'simulated database failure'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER test_fail_record_write BEFORE INSERT OR UPDATE ON "AdvancementRecord"
        FOR EACH ROW EXECUTE FUNCTION test_fail_record_write();
    `);
    t.after(() => db.pool.query(`DROP TRIGGER IF EXISTS test_fail_record_write ON "AdvancementRecord"`));

    const outcome = await settle(apply(tigerLeader, scout.id, [complete(a1.id), complete(a2.id)]));
    assert.equal(outcome.ok, false);
    assert.deepEqual(await recordsFor(scout.id), [], "the first upsert rolled back with the second");
  });
});

describe("advancement: who may apply", () => {
  it("still turns away another den's leader, a parent and a signed-out user, writing nothing", async () => {
    const { scout, a1, wolfLeader, tigerLeader } = await tigerScout();
    const parent = await fx.user("PARENT", { scoutIds: [scout.id] });
    const counts = await writeCounts();

    assert.deepEqual(await apply(wolfLeader, scout.id, [complete(a1.id)]), {
      ok: false,
      error: "Not authorized for this den.",
    });
    assert.deepEqual(await apply(parent, scout.id, [complete(a1.id)]), { ok: false, error: "Not authorized for this den." });
    const signedOut = await asAnonymous(() => advancement.applyAdventureChangesAction(scout.id, [complete(a1.id)]));
    assert.deepEqual(signedOut.result, { ok: false, error: "Not authorized." });
    assert.deepEqual(await writeCounts(), counts);

    assert.deepEqual(await apply(tigerLeader, scout.id, [complete(a1.id)]), { ok: true });
    const committee = await fx.user("COMMITTEE");
    assert.deepEqual(await apply(committee, scout.id, [uncheck(a1.id)]), { ok: true });
  });

  it("refuses an inactive scout", async () => {
    const { tigers, a1 } = await tigerScout();
    const inactive = await fx.scout(tigers.id, { active: false, firstName: "Sleepy" });
    const result = await apply(admin, inactive.id, [complete(a1.id)]);
    assert.deepEqual(result, { ok: false, error: "Sleepy is inactive — make them active to update advancement." });
  });
});

describe("advancement: a scout moved while an Apply waits", () => {
  it("refuses the Apply once a move to another rank's den commits first", async (t) => {
    const { scout, wolves, a1 } = await tigerScout();
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(`UPDATE "Scout" SET "denId" = $1 WHERE id = $2`, [wolves.id, scout.id]);

    const pending = apply(admin, scout.id, [complete(a1.id)]);
    await waitForLockWait(db.pool);
    await holder.commit();

    const result = await pending;
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, WRONG_RANK);
    assert.deepEqual(await recordsFor(scout.id), []);
  });

  it("refuses a den leader once the scout is moved out of their den first", async (t) => {
    const { scout, a1, tigerLeader } = await tigerScout();
    const otherTigers = await fx.den("TIGER");
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(`UPDATE "Scout" SET "denId" = $1 WHERE id = $2`, [otherTigers.id, scout.id]);

    const pending = apply(tigerLeader, scout.id, [complete(a1.id)]);
    await waitForLockWait(db.pool);
    await holder.commit();

    assert.deepEqual(await pending, { ok: false, error: "Not authorized for this den." });
    assert.deepEqual(await recordsFor(scout.id), []);
  });

  it("goes ahead when the move rolls back", async (t) => {
    const { scout, wolves, a1 } = await tigerScout();
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(`UPDATE "Scout" SET "denId" = $1 WHERE id = $2`, [wolves.id, scout.id]);

    const pending = apply(admin, scout.id, [complete(a1.id)]);
    await waitForLockWait(db.pool);
    await holder.rollback();

    assert.deepEqual(await pending, { ok: true });
    assert.equal((await recordsFor(scout.id)).length, 1);
  });

  it("makes a move wait while an Apply holds the scout", async (t) => {
    const { scout, wolves, a1 } = await tigerScout();
    // Stall the Apply after it has locked the scout: its insert needs a
    // key-share lock on the adventure's row, which this holds.
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(`SELECT id FROM "Adventure" WHERE id = $1 FOR UPDATE`, [a1.id]);
    const applying = apply(admin, scout.id, [complete(a1.id)]);
    await waitForLockWait(db.pool);

    // The Admin's move now has to queue behind the Apply's lock on the scout.
    const moving = db.prisma.scout.update({ where: { id: scout.id }, data: { denId: wolves.id } }).then(() => "moved");
    await waitForLockWaiters(db.pool, 2);
    assert.equal((await db.prisma.scout.findUniqueOrThrow({ where: { id: scout.id } })).denId !== wolves.id, true);

    await holder.commit();
    assert.deepEqual(await applying, { ok: true });
    assert.equal(await moving, "moved");
    const records = await recordsFor(scout.id);
    assert.equal(records.length, 1, "written while the scout was still a Tiger, before the move");
  });

  it("holds under repetition: 20 rounds of an Apply racing a move to another rank", async () => {
    const { scout, tigers, wolves, a1 } = await tigerScout();
    /*
     * The move takes the scout's row the way an Admin's edit would, and notes
     * how many records the scout had at that moment. In a valid serial order
     * the Apply either finished before the move (its record was already
     * there) or came after it (and was refused) — so the final count always
     * equals what the move saw.
     */
    async function move() {
      const mover = await openTransaction(db.pool);
      try {
        await mover.query(`SELECT id FROM "Scout" WHERE id = $1 FOR UPDATE`, [scout.id]);
        const { rows } = await mover.query(`SELECT count(*)::int AS n FROM "AdvancementRecord" WHERE "scoutId" = $1`, [scout.id]);
        await mover.query(`UPDATE "Scout" SET "denId" = $1 WHERE id = $2`, [wolves.id, scout.id]);
        await mover.commit();
        return rows[0].n as number;
      } finally {
        await mover.rollback();
      }
    }

    for (let round = 0; round < 20; round++) {
      await db.prisma.advancementRecord.deleteMany({ where: { scoutId: scout.id } });
      await db.prisma.scout.update({ where: { id: scout.id }, data: { denId: tigers.id } });

      const [result, recordsAtMove] = await Promise.all([apply(admin, scout.id, [complete(a1.id)]), move()]);
      const records = (await recordsFor(scout.id)).length;
      assert.equal(records, recordsAtMove, `round ${round}: nothing written after the scout left the rank`);
      if (result.ok) {
        assert.equal(records, 1, `round ${round}: saved means written`);
      } else {
        assert.match(result.error, WRONG_RANK, `round ${round}`);
        assert.equal(records, 0, `round ${round}: refused means nothing written`);
      }
    }
  });
});
