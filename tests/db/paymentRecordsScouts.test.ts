/*
 * Deleting scouts never loses a payment: the den roster's Remove, Users →
 * Scouts' Delete, a single dues payment's Delete and Start a Fresh Year all
 * copy every dues and event payment they remove into PaymentRecord (written by
 * the app, with names and a reason) in the same transaction as the delete.
 * Also checks the batched per-scout summary the roster warnings use counts the
 * same way as summarizePayments.
 */
import assert from "node:assert/strict";
import { afterEach, before, describe, it } from "node:test";
import { withTestDatabase } from "../support/db";
import { form, resetTestState, runAs, type SessionUser } from "../support/context";
import { packFixtures } from "./fixtures/pack";

const db = withTestDatabase("payment_records_scouts");
let fx: ReturnType<typeof packFixtures>;
let dens: typeof import("@/lib/actions/dens");
let scouts: typeof import("@/lib/actions/scouts");
let dues: typeof import("@/lib/actions/dues");
let reset: typeof import("@/lib/actions/reset");
let scoutDeletion: typeof import("@/lib/scoutDeletion");
let paymentRecords: typeof import("@/lib/paymentRecords");
let admin: SessionUser;
let master: SessionUser;

before(async () => {
  await db.ready;
  fx = packFixtures(db.prisma);
  dens = await import("@/lib/actions/dens");
  scouts = await import("@/lib/actions/scouts");
  dues = await import("@/lib/actions/dues");
  reset = await import("@/lib/actions/reset");
  scoutDeletion = await import("@/lib/scoutDeletion");
  paymentRecords = await import("@/lib/paymentRecords");
  admin = await fx.user("ADMIN", { displayName: "Pat Admin" });
  const m = await db.prisma.user.create({
    data: { username: "mattrosen", passwordHash: "x", role: "ADMIN", displayName: "Matt Master" },
  });
  master = { id: m.id, role: "ADMIN", sessionVersion: m.sessionVersion, displayName: m.displayName };
});

afterEach(() => resetTestState());

/** A scout with two dues payments ($100 + $20) and one $25 event payment. */
async function scoutWithPayments(denId?: string) {
  const den = denId ? { id: denId } : await fx.den("BEAR");
  const scout = await fx.scout(den.id);
  await db.prisma.duesPayment.createMany({
    data: [
      { scoutId: scout.id, amountCents: 10000, paidOn: new Date("2026-09-05"), note: "Zelle" },
      { scoutId: scout.id, amountCents: 2000, paidOn: new Date("2026-09-12") },
    ],
  });
  const event = await fx.event({ title: `Pinewood ${scout.id.slice(-4)}` });
  const reg = await db.prisma.eventRegistration.create({
    data: { eventId: event.id, scoutId: scout.id, amountOwedCents: 2500 },
  });
  await db.prisma.eventPayment.create({
    data: { eventRegistrationId: reg.id, amountCents: 2500, paidOn: new Date("2026-10-01"), recordedByUserId: admin.id },
  });
  return { scout, den, event };
}

const recordsFor = (scoutId: string) =>
  db.prisma.paymentRecord.findMany({
    where: { details: { path: ["scoutId"], equals: scoutId } },
    orderBy: [{ kind: "asc" }, { amountCents: "desc" }],
  });

const lastAudit = (action: string) =>
  db.prisma.auditLog.findFirstOrThrow({ where: { action }, orderBy: { createdAt: "desc" } });

describe("deleting a scout keeps their payments", () => {
  it("Users → Scouts Delete copies dues and event payments with names and a reason", async () => {
    const { scout, event } = await scoutWithPayments();
    const name = `${scout.firstName} ${scout.lastName}`;

    const result = await runAs(admin, () => scouts.deleteScoutAction(scout.id));
    assert.deepEqual(result, { ok: true });

    assert.equal(await db.prisma.scout.count({ where: { id: scout.id } }), 0);
    assert.equal(await db.prisma.duesPayment.count({ where: { scoutId: scout.id } }), 0);

    const records = await recordsFor(scout.id);
    assert.equal(records.length, 3, "two dues + one event payment kept");
    assert.deepEqual(
      records.map((r) => [r.kind, r.amountCents]),
      [["DUES", 10000], ["DUES", 2000], ["EVENT", 2500]],
    );
    for (const r of records) {
      assert.equal(r.capturedBy, "app", "written by the app, not only the safety-net trigger");
      assert.equal(r.deletionReason, `Scout ${name} deleted`);
      assert.equal(r.deletedByUserId, admin.id);
      assert.equal(r.deletedByName, "Pat Admin");
      assert.equal(r.status, "NEEDS_DECISION");
      assert.equal(r.paidBy, name);
    }
    assert.match(records[0].paidFor, new RegExp(`^Dues — ${name} \\(`));
    assert.equal(records[0].note, "Zelle");
    assert.match(records[2].paidFor, new RegExp(`^${event.title} `));
    assert.equal(records[2].recordedByName, "Pat Admin");

    const audit = await lastAudit("scout.delete");
    assert.match(audit.summary, /— 3 payments \(\$145\.00\) kept in Payment Records$/);
  });

  it("den roster Remove keeps payments and still revokes linked parent sessions", async () => {
    const { scout, den } = await scoutWithPayments();
    const parent = await fx.user("PARENT", { scoutIds: [scout.id] });

    await runAs(admin, () => dens.removeScoutAction(form({ scoutId: scout.id, denId: den.id })));

    assert.equal(await db.prisma.scout.count({ where: { id: scout.id } }), 0);
    const records = await recordsFor(scout.id);
    assert.equal(records.length, 3);
    assert.ok(records.every((r) => r.deletionReason === `Scout ${scout.firstName} ${scout.lastName} deleted`));
    const after = await db.prisma.user.findUniqueOrThrow({ where: { id: parent.id } });
    assert.equal(after.sessionVersion, parent.sessionVersion + 1);
    assert.match((await lastAudit("scout.delete")).summary, /kept in Payment Records$/);
  });

  it("a scout with no payments deletes as before, with no records and no note", async () => {
    const den = await fx.den("WOLF");
    const scout = await fx.scout(den.id);
    const before = await db.prisma.paymentRecord.count();

    await runAs(admin, () => scouts.deleteScoutAction(scout.id));

    assert.equal(await db.prisma.paymentRecord.count(), before);
    assert.doesNotMatch((await lastAudit("scout.delete")).summary, /Payment Records/);
  });

  it("the copy and the delete roll back together", async () => {
    const { scout } = await scoutWithPayments();
    const before = await db.prisma.paymentRecord.count();
    // Make the scout's delete fail after keepPaymentRecords has already written its copies.
    await db.pool.query(`
      CREATE FUNCTION test_block_scout_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.id = '${scout.id}' THEN RAISE EXCEPTION 'blocked by test'; END IF;
        RETURN OLD;
      END $$;
      CREATE TRIGGER test_block_scout_delete BEFORE DELETE ON "Scout"
        FOR EACH ROW EXECUTE FUNCTION test_block_scout_delete();`);
    try {
      await assert.rejects(runAs(admin, () => scouts.deleteScoutAction(scout.id)), /blocked by test/);
    } finally {
      await db.pool.query(`DROP TRIGGER test_block_scout_delete ON "Scout"; DROP FUNCTION test_block_scout_delete();`);
    }
    assert.equal(await db.prisma.scout.count({ where: { id: scout.id } }), 1, "scout still there");
    assert.equal(await db.prisma.duesPayment.count({ where: { scoutId: scout.id } }), 2);
    assert.equal(await db.prisma.paymentRecord.count(), before, "no copies left behind for a delete that didn't happen");
  });
});

describe("deleting a single dues payment", () => {
  it("keeps just that payment, then removes it", async () => {
    const { scout } = await scoutWithPayments();
    const [first, second] = await db.prisma.duesPayment.findMany({
      where: { scoutId: scout.id },
      orderBy: { amountCents: "desc" },
    });

    await runAs(admin, () => dues.deleteDuesPaymentAction(form({ paymentId: second.id, scoutId: scout.id })));

    assert.equal(await db.prisma.duesPayment.count({ where: { id: second.id } }), 0);
    assert.equal(await db.prisma.duesPayment.count({ where: { id: first.id } }), 1, "the other payment stays");
    const records = await db.prisma.paymentRecord.findMany({ where: { originalId: second.id } });
    assert.equal(records.length, 1);
    assert.equal(records[0].kind, "DUES");
    assert.equal(records[0].amountCents, 2000);
    assert.equal(records[0].capturedBy, "app");
    assert.equal(records[0].deletionReason, "Dues payment deleted");
    assert.equal(records[0].deletedByName, "Pat Admin");
    assert.match((await lastAudit("dues.payment.delete")).summary, /\$20\.00 dues payment .* kept in Payment Records$/);
  });
});

describe("Start a Fresh Year", () => {
  it("keeps every payment of the season's scouts and leaves other seasons alone", async () => {
    const year = "2019-2020";
    const oldDen = await db.prisma.den.create({ data: { rank: "TIGER", scoutingYear: year, label: "R1" } });
    const a = await scoutWithPayments(oldDen.id);
    const b = await scoutWithPayments(oldDen.id);
    const unpaid = await fx.scout(oldDen.id);
    const keep = await scoutWithPayments(); // 2026-2027, not reset

    const state = await runAs(master, () =>
      reset.resetPackDataAction({}, form({ scoutingYear: year, confirmation: `RESET ${year}` })),
    );
    assert.deepEqual(state, { deletedCount: 3, scoutingYear: year });

    for (const s of [a.scout, b.scout]) {
      const records = await recordsFor(s.id);
      assert.equal(records.length, 3);
      assert.ok(records.every((r) => r.deletionReason === `Season ${year} reset (Start a Fresh Year)`));
      assert.ok(records.every((r) => r.capturedBy === "app" && r.deletedByName === "Matt Master"));
    }
    assert.equal(await db.prisma.scout.count({ where: { id: unpaid.id } }), 0);
    assert.equal((await recordsFor(keep.scout.id)).length, 0, "other season untouched");
    assert.equal(await db.prisma.duesPayment.count({ where: { scoutId: keep.scout.id } }), 2);

    const audit = await lastAudit("reset.packData");
    assert.match(audit.summary, /— 6 payments \(\$290\.00\) kept in Payment Records$/);
    assert.ok(JSON.stringify(audit.details).includes("Payments kept in Payment Records"));
  });

  it("a wrong confirmation phrase keeps nothing and deletes nothing", async () => {
    const year = "2018-2019";
    const oldDen = await db.prisma.den.create({ data: { rank: "TIGER", scoutingYear: year, label: "R2" } });
    const { scout } = await scoutWithPayments(oldDen.id);

    const state = await runAs(master, () =>
      reset.resetPackDataAction({}, form({ scoutingYear: year, confirmation: "RESET" })),
    );
    assert.ok(state.error);
    assert.equal(await db.prisma.scout.count({ where: { id: scout.id } }), 1);
    assert.equal((await recordsFor(scout.id)).length, 0);
  });
});

describe("warning numbers", () => {
  it("paymentSummariesByScout matches summarizePayments scout by scout", async () => {
    const one = await scoutWithPayments();
    const two = await scoutWithPayments();
    const none = await fx.scout(one.den.id);

    const batched = await scoutDeletion.paymentSummariesByScout([one.scout.id, two.scout.id, none.id, one.scout.id]);
    for (const id of [one.scout.id, two.scout.id]) {
      assert.deepEqual(batched.get(id), await paymentRecords.summarizePayments({ scoutIds: [id] }));
      assert.deepEqual(batched.get(id), { count: 3, totalCents: 14500 });
    }
    assert.equal(batched.get(none.id), undefined);
    assert.deepEqual(await paymentRecords.summarizePayments({ scoutIds: [none.id] }), { count: 0, totalCents: 0 });
  });

  it("the warning sentence names the count and total, and is empty with no payments", () => {
    const text = paymentRecords.paymentDeletionWarning({ count: 3, totalCents: 14500 });
    assert.match(text, /^ ⚠ This has 3 payments totaling \$145\.00 attached\./);
    assert.match(text, /Admin → Payment Records/);
    assert.equal(paymentRecords.paymentDeletionWarning({ count: 0, totalCents: 0 }), "");
  });
});
