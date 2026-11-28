/*
 * Pending Awards: the loader (who sees which dens, agreeing with the audit
 * page's "Ready for award"), the bulk award action (validation, den access,
 * inactive scouts, skips, all-or-nothing, locking order), its audit entries,
 * and Undo — against the real database.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { withTestDatabase } from "../support/db";
import { asAnonymous, resetTestState, runAs, settle, type SessionUser } from "../support/context";
import { packFixtures } from "./fixtures/pack";

const db = withTestDatabase("pending_awards");
let advancement: typeof import("@/lib/actions/advancement");
let pending: typeof import("@/lib/pendingAwardsData");
let audit: typeof import("@/lib/advancementAuditData");
let fx: ReturnType<typeof packFixtures>;
let admin: SessionUser;

// The fixture dens are 2026-2027; the loader is pinned to a day in that season.
const NOW = new Date("2026-11-25T15:00:00Z");
const NO_FILTERS = { denId: null, type: "all" as const, adventure: null, before: null };
const d = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const ymd = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;

before(async () => {
  await db.ready;
  advancement = await import("@/lib/actions/advancement");
  pending = await import("@/lib/pendingAwardsData");
  audit = await import("@/lib/advancementAuditData");
  fx = packFixtures(db.prisma);
  admin = await fx.user("ADMIN");
});

beforeEach(() => resetTestState());

/** A Wolf den with three scouts, each with completed-but-unawarded adventures, plus a leader. */
async function wolfDen() {
  const den = await fx.den("WOLF");
  const named = async (name: string) =>
    (await db.prisma.adventure.findUnique({ where: { rank_name: { rank: "WOLF", name } } })) ?? fx.adventure("WOLF", name);
  const [bobcat, water, elective] = [await named("Bobcat"), await named("Paws on the Path"), await fx.adventure("WOLF")];
  const scouts = [await fx.scout(den.id, { firstName: "Avery" }), await fx.scout(den.id, { firstName: "Blake" }), await fx.scout(den.id, { firstName: "Casey" })];
  const complete = (scoutId: string, adventureId: string, completedDate: string, awardedDate: string | null = null) =>
    db.prisma.advancementRecord.create({
      data: { scoutId, adventureId, completed: true, completedDate: d(completedDate), awardedDate: awardedDate ? d(awardedDate) : null },
    });
  await complete(scouts[0].id, bobcat.id, "2026-09-18");
  await complete(scouts[0].id, water.id, "2026-10-09");
  await complete(scouts[1].id, bobcat.id, "2026-09-25");
  await complete(scouts[1].id, elective.id, "2026-11-20"); // after the award date used below
  await complete(scouts[2].id, bobcat.id, "2026-09-18", "2026-10-01"); // already awarded
  const leader = await fx.user("DEN", { denIds: [den.id] });
  return { den, bobcat, water, elective, scouts, leader };
}

const award = (user: SessionUser, items: unknown, date: unknown) =>
  runAs(user, () =>
    advancement.awardPendingAction(items as Parameters<typeof advancement.awardPendingAction>[0], date as string),
  );
const pair = (scoutId: string, adventureId: string) => ({ scoutId, adventureId });

async function snapshot() {
  const records = await db.prisma.advancementRecord.findMany({ orderBy: { id: "asc" } });
  return { records: records.map((r) => [r.id, ymd(r.awardedDate), r.updatedAt.toISOString()]), audits: await db.prisma.auditLog.count() };
}

/** The "Ready for award" number the audit page shows this user for one den. */
async function readyOnAuditPage(user: SessionUser, denId: string) {
  const { metrics } = await runAs(user, async () => {
    const { getSession } = await import("@/lib/auth");
    return audit.loadAdvancementAudit((await getSession())!, audit.parseAdvancementAuditFilters({ year: "2026-2027", denId }, NOW));
  });
  return metrics.readyForAward;
}

describe("pending awards: the list", () => {
  it("lists completed, unawarded adventures of active scouts, agreeing with the audit page's count", async () => {
    const { den, scouts, leader } = await wolfDen();
    const inactive = await fx.scout(den.id, { active: false });
    const adv = await fx.adventure("WOLF");
    await db.prisma.advancementRecord.create({ data: { scoutId: inactive.id, adventureId: adv.id, completed: true, completedDate: d("2026-10-01") } });

    const data = await runAs(leader, async () => {
      const { getSession } = await import("@/lib/auth");
      return pending.loadPendingAwards((await getSession())!, { ...NO_FILTERS, denId: den.id }, NOW);
    });
    assert.equal(data.items.length, 4, "Casey's Bobcat is already awarded");
    assert.ok(!data.items.some((i) => i.scoutId === scouts[2].id));
    assert.ok(!data.items.some((i) => i.scoutId === inactive.id), "inactive scouts never appear");
    assert.equal(data.readyForAwardTotal, await readyOnAuditPage(leader, den.id));
  });

  it("narrows a Den Leader to their own dens and lets Committee see every den; parents get nothing", async () => {
    const mine = await wolfDen();
    const theirs = await wolfDen();
    const load = (user: SessionUser, denId: string | null = null) =>
      runAs(user, async () => {
        const { getSession } = await import("@/lib/auth");
        return pending.loadPendingAwards((await getSession())!, { ...NO_FILTERS, denId }, NOW);
      });

    const leaderView = await load(mine.leader);
    assert.ok(leaderView.items.length > 0);
    assert.ok(leaderView.items.every((i) => i.denId === mine.den.id));
    assert.equal((await load(mine.leader, theirs.den.id)).items.length, 0, "another den's id in the URL matches nothing");

    const committee = await fx.user("COMMITTEE");
    const all = await load(committee);
    assert.ok(all.items.some((i) => i.denId === mine.den.id) && all.items.some((i) => i.denId === theirs.den.id));

    const parent = await fx.user("PARENT", { scoutIds: [mine.scouts[0].id] });
    assert.equal((await settle(load(parent))).ok, false);
  });
});

describe("pending awards: shopping list downloads", () => {
  const get = async (user: SessionUser, path: string, query = "") => {
    const route = path.endsWith("/pdf") ? await import("@/app/api/awards/export/pdf/route") : await import("@/app/api/awards/export/route");
    const { NextRequest } = await import("next/server");
    return runAs(user, () => route.GET(new NextRequest(`https://portal.pack376nyc.org${path}${query}`)));
  };
  const totalOf = (csv: string) => Number(csv.trim().split("\n").at(-1)!.split(",")[3]);

  it("counts what the page lists; another den's id gives a Den Leader nothing of that den", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: NOW });
    const mine = await wolfDen();
    const theirs = await wolfDen();
    const pageItems = await runAs(mine.leader, async () => {
      const { getSession } = await import("@/lib/auth");
      return (await pending.loadPendingAwards((await getSession())!, NO_FILTERS, NOW)).items;
    });

    const own = await get(mine.leader, "/api/awards/export");
    assert.equal(own.status, 200);
    const csv = await own.text();
    assert.equal(totalOf(csv), pageItems.length);
    assert.match(own.headers.get("Content-Disposition") ?? "", /pack376-shopping-list-2026-2027\.csv/);

    const foreign = await get(mine.leader, "/api/awards/export", `?denId=${theirs.den.id}`);
    assert.equal(foreign.status, 200);
    assert.equal(totalOf(await foreign.text()), 0);
    const pdf = await get(mine.leader, "/api/awards/export/pdf", `?denId=${theirs.den.id}`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("Content-Type"), "application/pdf");

    const parent = await fx.user("PARENT", { scoutIds: [mine.scouts[0].id] });
    assert.equal((await get(parent, "/api/awards/export")).status, 403);
    const { GET } = await import("@/app/api/awards/export/route");
    const { NextRequest } = await import("next/server");
    assert.equal((await asAnonymous(() => GET(new NextRequest("https://portal.pack376nyc.org/api/awards/export")))).result.status, 401);
  });
});

describe("pending awards: bulk award", () => {
  it("awards every eligible item, skips what can't be, and logs one entry per scout", async () => {
    const { den, bobcat, water, elective, scouts, leader } = await wolfDen();
    const readyBefore = await readyOnAuditPage(admin, den.id);

    const result = await award(
      leader,
      [pair(scouts[0].id, bobcat.id), pair(scouts[0].id, water.id), pair(scouts[1].id, bobcat.id), pair(scouts[1].id, elective.id), pair(scouts[2].id, bobcat.id)],
      "2026-11-15",
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.awarded, 3);
    assert.equal(result.scouts, 2);
    assert.deepEqual(
      result.skipped.map((s) => [s.scoutId, s.adventureId, s.reason]).sort(),
      [
        [scouts[1].id, elective.id, "completed_after"],
        [scouts[2].id, bobcat.id, "not_pending"],
      ].sort(),
    );

    const rows = await db.prisma.advancementRecord.findMany({ where: { scout: { denId: den.id } } });
    const byKey = new Map(rows.map((r) => [`${r.scoutId}:${r.adventureId}`, r]));
    for (const key of [`${scouts[0].id}:${bobcat.id}`, `${scouts[0].id}:${water.id}`, `${scouts[1].id}:${bobcat.id}`]) {
      assert.equal(ymd(byKey.get(key)!.awardedDate), "2026-11-15", key);
      assert.equal(byKey.get(key)!.completed, true);
      assert.equal(byKey.get(key)!.updatedByUserId, leader.id);
    }
    assert.equal(ymd(byKey.get(`${scouts[0].id}:${bobcat.id}`)!.completedDate), "2026-09-18", "completion date untouched");
    assert.equal(byKey.get(`${scouts[1].id}:${elective.id}`)!.awardedDate, null, "completed after the award date: skipped");
    assert.equal(ymd(byKey.get(`${scouts[2].id}:${bobcat.id}`)!.awardedDate), "2026-10-01", "already awarded: left alone");

    const entries = await db.prisma.auditLog.findMany({ where: { action: "advancement.update", entityId: { in: scouts.map((s) => s.id) } } });
    assert.equal(entries.length, 2);
    const avery = entries.find((e) => e.entityId === scouts[0].id)!;
    assert.match(avery.summary, /Awarded 2 adventures for Avery .* \(award date Nov 15, 2026\)/);
    assert.equal(avery.actorUserId, leader.id);
    assert.equal(avery.denId, den.id);
    assert.deepEqual(
      (avery.details as { label: string; from: string; to: string }[]).map((x) => [x.label, x.from, x.to]),
      [
        ["Bobcat", "Complete Sep 18, 2026", "Complete Sep 18, 2026 · awarded Nov 15, 2026"],
        ["Paws on the Path", "Complete Oct 9, 2026", "Complete Oct 9, 2026 · awarded Nov 15, 2026"],
      ],
    );

    assert.equal(await readyOnAuditPage(admin, den.id), readyBefore - 3, "the audit page's Ready for award drops by what was awarded");

    // A resubmit of the same batch awards nothing and logs nothing.
    const audits = await db.prisma.auditLog.count();
    const again = await award(leader, [pair(scouts[0].id, bobcat.id)], "2026-11-15");
    assert.ok(again.ok);
    assert.equal(again.awarded, 0);
    assert.equal(again.undo, null);
    assert.equal(await db.prisma.auditLog.count(), audits);
  });

  it("refuses a future or invalid date, too many items, and junk, writing nothing", async () => {
    const { bobcat, scouts, leader } = await wolfDen();
    const before = await snapshot();
    const refusals: [unknown, unknown, RegExp][] = [
      [[pair(scouts[0].id, bobcat.id)], "2199-01-01", /future/],
      [[pair(scouts[0].id, bobcat.id)], "2026-02-30", /real date/],
      [[pair(scouts[0].id, bobcat.id)], "", /Enter the date/],
      [Array.from({ length: 501 }, (_, i) => pair(scouts[0].id, `adv${i}`)), "2026-11-15", /too many/],
      [[], "2026-11-15", /Tick at least one/],
      [[{ scoutId: scouts[0].id }], "2026-11-15", /couldn't be read/],
      [[pair("no-such-scout", bobcat.id)], "2026-11-15", /couldn't be found/],
    ];
    for (const [items, date, message] of refusals) {
      const result = await award(leader, items, date);
      assert.equal(result.ok, false, String(date));
      assert.match(result.ok ? "" : result.error, message);
    }
    assert.deepEqual(await snapshot(), before);
  });

  it("turns away another den's leader, a parent and a signed-out user; Committee and denmatt may award", async () => {
    const mine = await wolfDen();
    const theirs = await wolfDen();
    const parent = await fx.user("PARENT", { scoutIds: [mine.scouts[0].id] });
    const before = await snapshot();

    const mixed = [pair(mine.scouts[0].id, mine.bobcat.id), pair(theirs.scouts[0].id, theirs.bobcat.id)];
    assert.deepEqual(await award(mine.leader, mixed, "2026-11-15"), { ok: false, error: "Not authorized for this den." });
    assert.deepEqual(await award(parent, [mixed[0]], "2026-11-15"), { ok: false, error: "Not authorized for this den." });
    const signedOut = await asAnonymous(() => advancement.awardPendingAction([mixed[0]], "2026-11-15"));
    assert.deepEqual(signedOut.result, { ok: false, error: "Not authorized." });
    assert.deepEqual(await snapshot(), before);

    const committee = await fx.user("COMMITTEE");
    const byCommittee = await award(committee, mixed, "2026-11-15");
    assert.ok(byCommittee.ok && byCommittee.awarded === 2);

    // The all-dens Den Leader test login reaches every den with no assignments.
    const created = await db.prisma.user.create({ data: { username: "denmatt", passwordHash: "x", role: "DEN", displayName: "Den Test" } });
    const denmatt: SessionUser = { id: created.id, role: "DEN", sessionVersion: created.sessionVersion, denIds: [] };
    const byDenmatt = await award(denmatt, [pair(theirs.scouts[0].id, theirs.water.id)], "2026-11-15");
    assert.ok(byDenmatt.ok && byDenmatt.awarded === 1, JSON.stringify(byDenmatt));
  });

  it("fails the whole batch for an inactive scout or another rank's adventure", async () => {
    const { bobcat, water, scouts, leader } = await wolfDen();
    const bearAdventure = await fx.adventure("BEAR");
    await db.prisma.advancementRecord.create({ data: { scoutId: scouts[1].id, adventureId: bearAdventure.id, completed: true, completedDate: d("2026-10-01") } });
    const before = await snapshot();

    assert.match(
      JSON.stringify(await award(leader, [pair(scouts[0].id, bobcat.id), pair(scouts[1].id, bearAdventure.id)], "2026-11-15")),
      /isn't part of its scout's rank/,
    );
    await db.prisma.scout.update({ where: { id: scouts[1].id }, data: { active: false } });
    const before2 = await snapshot();
    const result = await award(leader, [pair(scouts[0].id, bobcat.id), pair(scouts[0].id, water.id), pair(scouts[1].id, bobcat.id)], "2026-11-15");
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /is inactive .* Nothing was saved/);
    assert.deepEqual(await snapshot(), before2);
    assert.equal(before.audits, before2.audits);
  });

  it("writes none of a batch when the database fails partway through it", async (t) => {
    const { bobcat, water, scouts, leader } = await wolfDen();
    await db.pool.query(`
      CREATE OR REPLACE FUNCTION test_fail_award_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."scoutId" = '${scouts[1].id}' AND NEW."awardedDate" IS NOT NULL THEN RAISE EXCEPTION 'simulated database failure'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER test_fail_award_write BEFORE UPDATE ON "AdvancementRecord"
        FOR EACH ROW EXECUTE FUNCTION test_fail_award_write();
    `);
    t.after(() => db.pool.query(`DROP TRIGGER IF EXISTS test_fail_award_write ON "AdvancementRecord"`));
    const before = await snapshot();
    const outcome = await settle(award(leader, [pair(scouts[0].id, bobcat.id), pair(scouts[0].id, water.id), pair(scouts[1].id, bobcat.id)], "2026-11-15"));
    assert.equal(outcome.ok, false);
    assert.deepEqual(await snapshot(), before);
  });

  it("runs two overlapping batches at once without deadlocking", async () => {
    const { bobcat, water, scouts, leader } = await wolfDen();
    // Opposite orders: each would hold the scout the other wants without the sorted lock order.
    const [a, b] = await Promise.all([
      award(leader, [pair(scouts[0].id, bobcat.id), pair(scouts[1].id, bobcat.id)], "2026-11-15"),
      award(admin, [pair(scouts[1].id, bobcat.id), pair(scouts[0].id, water.id), pair(scouts[0].id, bobcat.id)], "2026-11-14"),
    ]);
    assert.ok(a.ok && b.ok, JSON.stringify([a, b]));
    assert.equal(a.awarded + b.awarded, 3, "each record awarded once, by whichever batch got there first");
  });
});

describe("pending awards: undo", () => {
  it("clears exactly what the batch set, leaving records edited since", async () => {
    const { den, bobcat, water, scouts, leader } = await wolfDen();
    const result = await award(leader, [pair(scouts[0].id, bobcat.id), pair(scouts[0].id, water.id), pair(scouts[1].id, bobcat.id)], "2026-11-15");
    assert.ok(result.ok && result.undo);
    const readyAfterAward = await readyOnAuditPage(admin, den.id);

    // Someone re-dates Avery's Paws for Water on the card afterwards.
    const edit = await runAs(admin, () =>
      advancement.applyAdventureChangesAction(scouts[0].id, [{ adventureId: water.id, completed: true, completedDate: "2026-10-09", awardedDate: "2026-11-16" }]),
    );
    assert.deepEqual(edit, { ok: true });

    // Another login can't undo this batch.
    const other = await fx.user("DEN", { denIds: [den.id] });
    const notMine = await runAs(other, () => advancement.undoAwardBatchAction(result.undo!));
    assert.ok(notMine.ok && notMine.cleared === 0 && notMine.changedSince === 3);

    const undo = await runAs(leader, () => advancement.undoAwardBatchAction(result.undo!));
    assert.ok(undo.ok, JSON.stringify(undo));
    assert.equal(undo.cleared, 2);
    assert.equal(undo.changedSince, 1);
    assert.deepEqual(undo.clearedKeys.sort(), [`${scouts[0].id}:${bobcat.id}`, `${scouts[1].id}:${bobcat.id}`].sort());

    const rows = new Map(
      (await db.prisma.advancementRecord.findMany({ where: { scoutId: { in: [scouts[0].id, scouts[1].id] } } })).map((r) => [`${r.scoutId}:${r.adventureId}`, r]),
    );
    assert.equal(rows.get(`${scouts[0].id}:${bobcat.id}`)!.awardedDate, null);
    assert.equal(rows.get(`${scouts[1].id}:${bobcat.id}`)!.awardedDate, null);
    assert.equal(rows.get(`${scouts[0].id}:${bobcat.id}`)!.completed, true, "undo never touches completion");
    assert.equal(ymd(rows.get(`${scouts[0].id}:${water.id}`)!.awardedDate), "2026-11-16", "edited since: left as it is");
    assert.equal(await readyOnAuditPage(admin, den.id), readyAfterAward + 2);

    const entry = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "advancement.update", entityId: scouts[1].id, summary: { startsWith: "Undid" } } });
    assert.match(entry.summary, /Undid the award of 1 adventure for Blake .* \(award date Nov 15, 2026 cleared\)/);

    // Undoing twice clears nothing more.
    const twice = await runAs(leader, () => advancement.undoAwardBatchAction(result.undo!));
    assert.ok(twice.ok && twice.cleared === 0);
  });

  it("refuses an undo for a den the user can't edit, or a scout now inactive", async () => {
    const mine = await wolfDen();
    const theirs = await wolfDen();
    const result = await award(admin, [pair(theirs.scouts[0].id, theirs.bobcat.id)], "2026-11-15");
    assert.ok(result.ok && result.undo);
    assert.deepEqual(await runAs(mine.leader, () => advancement.undoAwardBatchAction(result.undo!)), {
      ok: false,
      error: "Not authorized for this den.",
    });
    await db.prisma.scout.update({ where: { id: theirs.scouts[0].id }, data: { active: false } });
    const inactive = await runAs(admin, () => advancement.undoAwardBatchAction(result.undo!));
    assert.equal(inactive.ok, false);
    const row = await db.prisma.advancementRecord.findFirstOrThrow({ where: { scoutId: theirs.scouts[0].id, adventureId: theirs.bobcat.id } });
    assert.equal(ymd(row.awardedDate), "2026-11-15");
  });
});
