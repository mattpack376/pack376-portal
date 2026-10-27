/*
 * F2 (security review 2026-10-27): voiding, verifying, correcting and
 * restoring raffle payments against a real Postgres, with the races forced in
 * a known order. See raffle-support.ts for how a change is held "in flight".
 *
 * The rule under test: a Raffle Helper may void only a payment they recorded
 * that no Admin has verified — and that must still hold when an Admin's
 * verification lands while the helper's void is under way. Every outcome must
 * match some serial order of the two changes.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { openTransaction, withTestDatabase } from "../support/db";
import { form, runAs } from "../support/context";
import { editPaymentForm, raffleTestKit, type RaffleActions, type TestUser } from "./raffle-support";

const db = withTestDatabase("raffle_payments");
const kit = raffleTestKit(db);
let raffles: RaffleActions;
let admin: TestUser;
let admin2: TestUser;
let helper: TestUser;
let helper2: TestUser;
let viewer: TestUser;

before(async () => {
  await db.ready;
  raffles = await import("@/lib/actions/raffles");
  admin = await kit.makeUser("ADMIN");
  admin2 = await kit.makeUser("ADMIN");
  helper = await kit.makeUser("COMMITTEE", { raffleHelper: true });
  helper2 = await kit.makeUser("PARENT", { raffleHelper: true });
  viewer = await kit.makeUser("JUNIOR_ADMIN");
});


/** A raffle where `seller` sold box 1 to Ann, paid $10 cash on the spot. */
async function helperPayment(seller: TestUser = helper) {
  const raffle = await kit.makeRaffle();
  const ann = await kit.sell(seller, raffles, raffle.id, "Ann", "1", "CASH");
  const payment = await db.prisma.rafflePayment.findFirstOrThrow({ where: { entryId: ann.id } });
  assert.equal(payment.recordedByUserId, seller.id);
  return { raffle, ann, payment };
}

const verifyForm = (payment: { id: string; amountCents: number; method: string }) =>
  form({ paymentId: payment.id, verified: "true", amountCents: payment.amountCents, method: payment.method });

const voidForm = (paymentId: string, reason = "marked the wrong buyer") => form({ paymentId, reason });

async function paymentState(id: string) {
  const payment = await db.prisma.rafflePayment.findUniqueOrThrow({ where: { id } });
  return { verified: payment.verifiedAt !== null, voided: payment.voidedAt !== null, payment };
}

describe("helper void vs Admin verification", () => {
  it("an Admin verification in flight wins: the waiting helper void is refused (real actions)", async (t) => {
    const { payment } = await helperPayment();
    const paused = await kit.pauseUser(admin);
    t.after(() => paused.rollback());

    // The Admin's verify takes the raffle lock, ticks the payment, and stops
    // at its audit entry — not yet committed.
    const verifying = kit.act(admin, () => raffles.setPaymentVerifiedAction(verifyForm(payment)));
    await kit.waitForWaiters(1);
    // The helper's void has to wait for it rather than read the old state.
    const voiding = kit.act(helper, () => raffles.voidPaymentAction(voidForm(payment.id)));
    await kit.waitForWaiters(2);

    await paused.commit();
    assert.deepEqual(await kit.resultOf(verifying), {});
    const refused = await kit.resultOf(voiding);
    assert.match(refused.error ?? "", /already verified this payment/);

    const state = await paymentState(payment.id);
    assert.equal(state.verified, true);
    assert.equal(state.voided, false);
    assert.equal(await kit.auditCount("raffle.payment.void", payment.id), 0);
    assert.equal(await kit.auditCount("raffle.payment.verify", payment.id), 1);
  });

  it("a verification holding the raffle lock makes the helper's void re-read and refuse", async (t) => {
    const { raffle, payment } = await helperPayment();
    // What the Admin's verify transaction holds: the raffle row, then its write.
    const verification = await kit.holdRaffle(raffle.id);
    t.after(() => verification.rollback());
    await verification.query(`UPDATE "RafflePayment" SET "verifiedAt" = now(), "verifiedByName" = 'Admin' WHERE id = $1`, [payment.id]);

    const voiding = kit.act(helper, () => raffles.voidPaymentAction(voidForm(payment.id)));
    await kit.waitForWaiters(1);
    await verification.commit();

    assert.match((await kit.resultOf(voiding)).error ?? "", /already verified this payment/);
    const state = await paymentState(payment.id);
    assert.deepEqual([state.verified, state.voided], [true, false]);
  });

  it("the helper's write itself requires 'unverified': a verification landing after its check still stops it", async (t) => {
    const { payment } = await helperPayment();
    // A verification written outside the raffle lock, so the helper's check
    // passes on the old state and only its conditional UPDATE can catch it.
    // (Before the fix the UPDATE was by id alone and voided the verified payment.)
    const verification = await openTransaction(db.pool);
    t.after(() => verification.rollback());
    await verification.query(`UPDATE "RafflePayment" SET "verifiedAt" = now(), "verifiedByName" = 'Admin' WHERE id = $1`, [payment.id]);

    const voiding = kit.act(helper, () => raffles.voidPaymentAction(voidForm(payment.id)));
    await kit.waitForWaiters(1); // its UPDATE waits on the row the verification changed
    await verification.commit();

    const refused = await kit.resultOf(voiding);
    assert.match(refused.error ?? "", /changed a moment ago/);
    const state = await paymentState(payment.id);
    assert.deepEqual([state.verified, state.voided], [true, false]);
    assert.equal(await kit.auditCount("raffle.payment.void", payment.id), 0, "a refused void leaves no audit entry");
  });

  it("reverse order: the helper's void in flight wins and the Admin's verify is refused (real actions)", async (t) => {
    const { payment } = await helperPayment();
    const paused = await kit.pauseUser(helper);
    t.after(() => paused.rollback());

    const voiding = kit.act(helper, () => raffles.voidPaymentAction(voidForm(payment.id)));
    await kit.waitForWaiters(1);
    const verifying = kit.act(admin, () => raffles.setPaymentVerifiedAction(verifyForm(payment)));
    await kit.waitForWaiters(2);

    await paused.commit();
    assert.deepEqual(await kit.resultOf(voiding), {});
    assert.match((await kit.resultOf(verifying)).error ?? "", /voided a moment ago/);
    const state = await paymentState(payment.id);
    assert.deepEqual([state.verified, state.voided], [false, true]);
  });

  it("reverse order without the lock: the verify's write requires 'not voided'", async (t) => {
    const { payment } = await helperPayment();
    const voiding = await openTransaction(db.pool);
    t.after(() => voiding.rollback());
    await voiding.query(`UPDATE "RafflePayment" SET "voidedAt" = now(), "voidedByName" = 'Helper', "voidReason" = 'x' WHERE id = $1`, [payment.id]);

    const verifying = kit.act(admin, () => raffles.setPaymentVerifiedAction(verifyForm(payment)));
    await kit.waitForWaiters(1);
    await voiding.commit();
    const result = await kit.resultOf(verifying);

    const state = await paymentState(payment.id);
    assert.deepEqual([state.verified, state.voided], [false, true], "a voided payment is never also ticked verified");
    assert.match(result?.error ?? "", /changed a moment ago/);
  });

  it("20 rounds of a helper void racing an Admin verify always end in one serial outcome", async () => {
    for (let round = 0; round < 20; round++) {
      const { payment } = await helperPayment();
      const [voided, verified] = await Promise.all([
        kit.resultOf(kit.act(helper, () => raffles.voidPaymentAction(voidForm(payment.id)))),
        kit.resultOf(kit.act(admin, () => raffles.setPaymentVerifiedAction(verifyForm(payment)))),
      ]);
      const state = await paymentState(payment.id);
      assert.ok(!(state.verified && state.voided), `round ${round}: verified and voided at once`);
      if (state.voided) {
        assert.deepEqual(voided, {});
        assert.match(verified.error ?? "", /voided a moment ago/);
      } else {
        assert.equal(state.verified, true);
        assert.deepEqual(verified, {});
        assert.match(voided.error ?? "", /already verified/);
      }
    }
  });
});

describe("who may void", () => {
  it("a different helper can't void someone else's payment, even racing its owner", async () => {
    for (let round = 0; round < 10; round++) {
      const { payment } = await helperPayment(helper);
      const [own, other] = await Promise.all([
        kit.resultOf(kit.act(helper, () => raffles.voidPaymentAction(voidForm(payment.id, "mine")))),
        kit.resultOf(kit.act(helper2, () => raffles.voidPaymentAction(voidForm(payment.id, "not mine")))),
      ]);
      assert.deepEqual(own, {});
      assert.match(other.error ?? "", /only void a payment you recorded yourself|already voided/);
      const { payment: final } = await paymentState(payment.id);
      assert.equal(final.voidReason, "mine");
      assert.equal(final.voidedByName, helper.displayName);
    }
  });

  it("a helper can't void a payment an Admin recorded, but the Admin can void a helper's verified one", async () => {
    const raffle = await kit.makeRaffle();
    await kit.sell(admin, raffles, raffle.id, "Bea", "2", "ZELLE");
    const adminPayment = await db.prisma.rafflePayment.findFirstOrThrow({ where: { raffleId: raffle.id } });
    const refused = await runAs(helper, () => raffles.voidPaymentAction(voidForm(adminPayment.id)));
    assert.match(refused.error ?? "", /only void a payment you recorded yourself/);
    assert.equal((await paymentState(adminPayment.id)).voided, false);

    const { payment } = await helperPayment();
    assert.deepEqual(await runAs(admin, () => raffles.setPaymentVerifiedAction(verifyForm(payment))), {});
    assert.deepEqual(await runAs(admin, () => raffles.voidPaymentAction(voidForm(payment.id, "duplicate"))), {});
    assert.equal((await paymentState(payment.id)).voided, true);
  });

  it("a Junior Admin without the permission, and a helper on Admin-only actions, are turned away", async () => {
    const { raffle, payment } = await helperPayment();
    await assert.rejects(runAs(viewer, () => raffles.voidPaymentAction(voidForm(payment.id))), /Not authorized/);
    await assert.rejects(runAs(viewer, () => raffles.assignBoxesAction(form({ raffleId: raffle.id, name: "X", boxes: "9" }))), /Not authorized/);
    await assert.rejects(runAs(helper, () => raffles.setPaymentVerifiedAction(verifyForm(payment))), /admin only/);
    await assert.rejects(
      runAs(helper, () => raffles.verifyAllPaymentsAction(form({ raffleId: raffle.id, method: "CASH", reviewed: [`${payment.id}:1000`] }))),
      /admin only/,
    );
    await assert.rejects(runAs(helper, () => raffles.restorePaymentAction(form({ paymentId: payment.id }))), /admin only/);
    await assert.rejects(
      runAs(helper, () => raffles.updatePaymentAction(form({ paymentId: payment.id, entryId: "", amount: "1", method: "CASH", payerName: "Z" }))),
      /admin only/,
    );
    await assert.rejects(
      runAs(helper, () => raffles.recordPaymentAction(form({ raffleId: raffle.id, entryId: "", amount: "5", method: "ZELLE", payerName: "Z" }))),
      /admin only/,
    );
    const state = await paymentState(payment.id);
    assert.deepEqual([state.verified, state.voided], [false, false]);
  });
});

describe("already-voided payments", () => {
  it("two voids at once: one wins, the other is told it's already voided, one audit entry", async () => {
    for (let round = 0; round < 10; round++) {
      const { payment } = await helperPayment();
      const results = await Promise.all([
        kit.resultOf(kit.act(admin, () => raffles.voidPaymentAction(voidForm(payment.id, "first")))),
        kit.resultOf(kit.act(admin2, () => raffles.voidPaymentAction(voidForm(payment.id, "second")))),
      ]);
      const ok = results.filter((result) => !result.error);
      assert.equal(ok.length, 1, `round ${round}: exactly one void`);
      assert.match(results.find((result) => result.error)?.error ?? "", /already voided/);
      assert.equal(await kit.auditCount("raffle.payment.void", payment.id), 1);
    }
  });

  it("verify, void and restore on a payment voided meanwhile behave", async () => {
    const { payment } = await helperPayment();
    assert.deepEqual(await runAs(admin, () => raffles.voidPaymentAction(voidForm(payment.id, "dup"))), {});

    assert.match((await runAs(helper, () => raffles.voidPaymentAction(voidForm(payment.id)))).error ?? "", /already voided/);
    assert.match((await runAs(admin2, () => raffles.setPaymentVerifiedAction(verifyForm(payment)))).error ?? "", /voided/);
    assert.match(
      (await runAs(admin2, () => raffles.updatePaymentAction(editPaymentForm(payment)))).error ?? "",
      /voided/,
    );

    // Two restores at once: one restores, the other finds nothing to do.
    const restores = await Promise.all([
      kit.resultOf(kit.act(admin, () => raffles.restorePaymentAction(form({ paymentId: payment.id })))),
      kit.resultOf(kit.act(admin2, () => raffles.restorePaymentAction(form({ paymentId: payment.id })))),
    ]);
    assert.deepEqual(restores, [{}, {}]);
    assert.equal(await kit.auditCount("raffle.payment.restore", payment.id), 1);
    const state = await paymentState(payment.id);
    assert.deepEqual([state.verified, state.voided], [false, false]);
  });

  it("a restore in flight and a helper void: the void sees the restored payment", async (t) => {
    const { payment } = await helperPayment();
    assert.deepEqual(await runAs(helper, () => raffles.voidPaymentAction(voidForm(payment.id, "oops"))), {});
    const paused = await kit.pauseUser(admin);
    t.after(() => paused.rollback());
    const restoring = kit.act(admin, () => raffles.restorePaymentAction(form({ paymentId: payment.id })));
    await kit.waitForWaiters(1);
    const voiding = kit.act(helper, () => raffles.voidPaymentAction(voidForm(payment.id, "again")));
    await kit.waitForWaiters(2);
    await paused.commit();
    assert.deepEqual(await kit.resultOf(restoring), {});
    assert.deepEqual(await kit.resultOf(voiding), {}, "restored as unverified, so its recorder may void it again");
    const { payment: final } = await paymentState(payment.id);
    assert.equal(final.voidReason, "again");
  });
});

describe("Verify All", () => {
  /** Three cash payments: $10, $10, $20, all recorded by the helper. */
  async function threeCashPayments() {
    const raffle = await kit.makeRaffle();
    await kit.sell(helper, raffles, raffle.id, "Ann", "1", "CASH");
    await kit.sell(helper, raffles, raffle.id, "Ben", "2", "CASH");
    await kit.sell(helper, raffles, raffle.id, "Cal", "3, 4", "CASH");
    const payments = await db.prisma.rafflePayment.findMany({ where: { raffleId: raffle.id }, orderBy: { amountCents: "asc" } });
    const reviewed = payments.map((payment) => `${payment.id}:${payment.amountCents}`);
    return { raffle, payments, reviewed };
  }

  const verifyAll = (raffleId: string, reviewed: string[], method = "CASH") =>
    raffles.verifyAllPaymentsAction(form({ raffleId, method, reviewed }));

  async function verifiedIds(raffleId: string) {
    const rows = await db.prisma.rafflePayment.findMany({ where: { raffleId, verifiedAt: { not: null } }, select: { id: true } });
    return rows.map((row) => row.id).sort();
  }

  it("verifies exactly the reviewed list", async () => {
    const { raffle, payments, reviewed } = await threeCashPayments();
    assert.deepEqual(await runAs(admin, () => verifyAll(raffle.id, reviewed)), {});
    assert.deepEqual(await verifiedIds(raffle.id), payments.map((p) => p.id).sort());
    const entry = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "raffle.payment.verifyAll", entityId: raffle.id } });
    assert.match(entry.summary, /3 remaining Cash payments \(\$40\.00\)/);
  });

  it("an amount corrected while it waits: nothing is verified", async (t) => {
    const { raffle, payments, reviewed } = await threeCashPayments();
    // updatePaymentAction's transaction, held open: the raffle lock, then its write.
    const correction = await kit.holdRaffle(raffle.id);
    t.after(() => correction.rollback());
    await correction.query(`UPDATE "RafflePayment" SET "amountCents" = 1500 WHERE id = $1`, [payments[1].id]);

    const verifying = kit.act(admin, () => verifyAll(raffle.id, reviewed));
    await kit.waitForWaiters(1);
    await correction.commit();
    const result = await kit.resultOf(verifying);

    // Before the fix all three were ticked, the corrected $15 one included.
    assert.deepEqual(await verifiedIds(raffle.id), []);
    assert.match(result?.error ?? "", /1 of the 3 Cash payments on your screen was voided or changed after the page loaded \((Ann|Ben)'s \$10\.00\)/);
    assert.equal(await kit.auditCount("raffle.payment.verifyAll", raffle.id), 0);
  });

  it("an amount corrected outside the lock is still caught by the write's amount condition", async (t) => {
    const { raffle, payments, reviewed } = await threeCashPayments();
    const correction = await openTransaction(db.pool);
    t.after(() => correction.rollback());
    await correction.query(`UPDATE "RafflePayment" SET "amountCents" = 1500 WHERE id = $1`, [payments[0].id]);

    const verifying = kit.act(admin, () => verifyAll(raffle.id, reviewed));
    await kit.waitForWaiters(1);
    await correction.commit();
    const result = await kit.resultOf(verifying);

    assert.deepEqual(await verifiedIds(raffle.id), [], "rolled back as a whole");
    assert.match(result?.error ?? "", /changed a moment ago/);
  });

  it("a method changed, or a payment voided, after the page loaded: nothing is verified", async () => {
    const { raffle, payments, reviewed } = await threeCashPayments();
    await db.prisma.rafflePayment.update({ where: { id: payments[2].id }, data: { method: "ZELLE" } });
    assert.match((await runAs(admin, () => verifyAll(raffle.id, reviewed))).error ?? "", /voided or changed/);

    const second = await threeCashPayments();
    assert.deepEqual(await runAs(helper, () => raffles.voidPaymentAction(voidForm(second.payments[0].id))), {});
    assert.match((await runAs(admin, () => verifyAll(second.raffle.id, second.reviewed))).error ?? "", /voided or changed/);
    assert.deepEqual(await verifiedIds(raffle.id), []);
    assert.deepEqual(await verifiedIds(second.raffle.id), []);
  });

  it("a payment recorded after the page loaded isn't swept in", async () => {
    const { raffle, payments, reviewed } = await threeCashPayments();
    await kit.sell(helper, raffles, raffle.id, "Dee", "5", "CASH");
    assert.deepEqual(await runAs(admin, () => verifyAll(raffle.id, reviewed)), {});
    assert.deepEqual(await verifiedIds(raffle.id), payments.map((p) => p.id).sort());
    assert.equal(await db.prisma.rafflePayment.count({ where: { raffleId: raffle.id, verifiedAt: null } }), 1);
  });

  it("one ticked by another Admin meanwhile is fine; the rest are verified", async () => {
    const { raffle, payments, reviewed } = await threeCashPayments();
    assert.deepEqual(await runAs(admin2, () => raffles.setPaymentVerifiedAction(verifyForm(payments[0]))), {});
    assert.deepEqual(await runAs(admin, () => verifyAll(raffle.id, reviewed)), {});
    assert.equal((await verifiedIds(raffle.id)).length, 3);
  });

  it("refuses a tampered or empty list", async () => {
    const { raffle, payments } = await threeCashPayments();
    for (const reviewed of [[], ["nope"], [`${payments[0].id}:abc`], [`${payments[0].id}:1000`, `${payments[0].id}:1000`]]) {
      assert.match((await runAs(admin, () => verifyAll(raffle.id, reviewed))).error ?? "", /out of date/);
    }
    // A payment from another raffle can't be named in this one's list.
    const other = await threeCashPayments();
    assert.match(
      (await runAs(admin, () => verifyAll(raffle.id, [`${other.payments[0].id}:${other.payments[0].amountCents}`]))).error ?? "",
      /voided or changed/,
    );
    assert.deepEqual(await verifiedIds(raffle.id), []);
    assert.deepEqual(await verifiedIds(other.raffle.id), []);
  });

  it("real actions: a correction in flight, then Verify All, is refused", async (t) => {
    const { raffle, payments, reviewed } = await threeCashPayments();
    const paused = await kit.pauseUser(admin2);
    t.after(() => paused.rollback());
    const correcting = kit.act(admin2, () =>
      raffles.updatePaymentAction(editPaymentForm(payments[1], { amount: "15" })),
    );
    await kit.waitForWaiters(1);
    const verifying = kit.act(admin, () => verifyAll(raffle.id, reviewed));
    await kit.waitForWaiters(2);
    await paused.commit();
    assert.deepEqual(await kit.resultOf(correcting), {});
    assert.match((await kit.resultOf(verifying)).error ?? "", /voided or changed/);
    assert.deepEqual(await verifiedIds(raffle.id), []);
  });

  it("real actions: Verify All in flight, then a correction — the correction clears that one's tick", async (t) => {
    const { raffle, payments, reviewed } = await threeCashPayments();
    const paused = await kit.pauseUser(admin);
    t.after(() => paused.rollback());
    const verifying = kit.act(admin, () => verifyAll(raffle.id, reviewed));
    await kit.waitForWaiters(1);
    const correcting = kit.act(admin2, () =>
      raffles.updatePaymentAction(editPaymentForm(payments[1], { amount: "15" })),
    );
    await kit.waitForWaiters(2);
    await paused.commit();
    assert.deepEqual(await kit.resultOf(verifying), {});
    assert.deepEqual(await kit.resultOf(correcting), {});
    const corrected = await paymentState(payments[1].id);
    assert.equal(corrected.payment.amountCents, 1500);
    assert.equal(corrected.verified, false, "the counted amount no longer matches, so the tick is cleared");
    assert.deepEqual(await verifiedIds(raffle.id), [payments[0].id, payments[2].id].sort());
  });

  it("20 rounds of Verify All racing a correction always match a serial order", async () => {
    for (let round = 0; round < 20; round++) {
      const { raffle, payments, reviewed } = await threeCashPayments();
      const [verified, corrected] = await Promise.all([
        kit.resultOf(kit.act(admin, () => verifyAll(raffle.id, reviewed))),
        kit.resultOf(
          kit.act(admin2, () =>
            raffles.updatePaymentAction(editPaymentForm(payments[1], { amount: "15" })),
          ),
        ),
      ]);
      assert.deepEqual(corrected, {});
      const ids = await verifiedIds(raffle.id);
      if (verified.error) {
        // The correction went first: nothing verified.
        assert.deepEqual(ids, [], `round ${round}`);
      } else {
        // Verify All went first, then the correction cleared the changed one.
        assert.deepEqual(ids, [payments[0].id, payments[2].id].sort(), `round ${round}`);
      }
      assert.equal((await paymentState(payments[1].id)).verified, false);
    }
  });
});

describe("single Verify and corrections", () => {
  it("a Verify button for an amount someone has since corrected is refused", async () => {
    const { payment } = await helperPayment();
    assert.deepEqual(
      await runAs(admin2, () => raffles.updatePaymentAction(editPaymentForm(payment, { amount: "7.50", method: "ZELLE" }))),
      {},
    );
    const stale = await runAs(admin, () => raffles.setPaymentVerifiedAction(verifyForm(payment)));
    assert.match(stale.error ?? "", /now \$7\.50 by zelle/);
    assert.equal((await paymentState(payment.id)).verified, false);

    // A Verify button with no amount on it (a page from before this change) is refused too.
    const old = await runAs(admin, () => raffles.setPaymentVerifiedAction(form({ paymentId: payment.id, verified: "true" })));
    assert.match(old.error ?? "", /out of date/);
  });

  it("a correction in flight vs a single Verify: the Verify sees the new amount and refuses (real actions)", async (t) => {
    const { payment } = await helperPayment();
    const paused = await kit.pauseUser(admin2);
    t.after(() => paused.rollback());
    const correcting = kit.act(admin2, () =>
      raffles.updatePaymentAction(editPaymentForm(payment, { amount: "20" })),
    );
    await kit.waitForWaiters(1);
    const verifying = kit.act(admin, () => raffles.setPaymentVerifiedAction(verifyForm(payment)));
    await kit.waitForWaiters(2);
    await paused.commit();
    assert.deepEqual(await kit.resultOf(correcting), {});
    assert.match((await kit.resultOf(verifying)).error ?? "", /changed after this page loaded/);
    assert.equal((await paymentState(payment.id)).verified, false);
  });

  it("un-verifying needs no amount and is a no-op when already unverified", async () => {
    const { payment } = await helperPayment();
    assert.deepEqual(await runAs(admin, () => raffles.setPaymentVerifiedAction(verifyForm(payment))), {});
    assert.deepEqual(await runAs(admin, () => raffles.setPaymentVerifiedAction(form({ paymentId: payment.id, verified: "false" }))), {});
    assert.deepEqual(await runAs(admin2, () => raffles.setPaymentVerifiedAction(form({ paymentId: payment.id, verified: "false" }))), {});
    assert.equal(await kit.auditCount("raffle.payment.unverify", payment.id), 1);
    assert.equal((await paymentState(payment.id)).verified, false);
  });

  it("each payment change writes its audit entry with the change, attributed to the actor", async () => {
    const { payment } = await helperPayment();
    assert.deepEqual(await runAs(helper, () => raffles.voidPaymentAction(voidForm(payment.id, "wrong buyer"))), {});
    const entry = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "raffle.payment.void", entityId: payment.id } });
    assert.equal(entry.actorUserId, helper.id);
    assert.equal(entry.ipAddress, "127.0.0.1");
    assert.match(entry.summary, /Voided a \$10\.00 Cash payment for Ann/);
  });
});
