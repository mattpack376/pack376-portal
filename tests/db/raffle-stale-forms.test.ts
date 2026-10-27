/*
 * Forms that were filled in from a page loaded before someone else's change
 * (follow-up review of the F2/F3 fix, 2026-10-27):
 *
 *  - A paid sale records boxes x price as money received, so it carries the
 *    price per box its page showed. If an Admin changed the price since, the
 *    sale is refused instead of recording money that never changed hands.
 *  - A payment's or a buyer's Edit form carries a fingerprint of the values it
 *    was filled in with. If another Admin (or helper) changed the row since,
 *    the save is refused instead of quietly putting the old values back.
 *
 * Every outcome must still match some serial order of the two changes.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { openTransaction, withTestDatabase } from "../support/db";
import { form, runAs } from "../support/context";
import { editEntryForm, editPaymentForm, raffleTestKit, type RaffleActions, type TestUser } from "./raffle-support";

const db = withTestDatabase("raffle_stale_forms");
const kit = raffleTestKit(db);
let raffles: RaffleActions;
let admin: TestUser;
let admin2: TestUser;
let helper: TestUser;
let helper2: TestUser;

before(async () => {
  await db.ready;
  raffles = await import("@/lib/actions/raffles");
  admin = await kit.makeUser("ADMIN");
  admin2 = await kit.makeUser("ADMIN");
  helper = await kit.makeUser("DEN", { raffleHelper: true });
  helper2 = await kit.makeUser("COMMITTEE", { raffleHelper: true });
});

const PRICE_CHANGED = /price per box changed from \$10\.00 to \$20\.00 after this page loaded\. Nothing was saved/;
const PAYMENT_EDIT_STALE = /That payment was changed after this page loaded/;

/** Admin's Edit Raffle form changing only the price. */
const reprice = (raffle: { id: string; name: string; boxCount: number; prizePercent: number }, price: string) =>
  form({ raffleId: raffle.id, name: raffle.name, boxCount: raffle.boxCount, price, prizePercent: raffle.prizePercent });

describe("a paid sale carries the price its page showed", () => {
  it("after a price change, a paid sale from the old page is refused; an unpaid one goes through", async () => {
    const raffle = await kit.makeRaffle({ priceCents: 1000 });
    assert.deepEqual(await runAs(admin, () => raffles.updateRaffleAction(reprice(raffle, "20"))), {});
    const salesLogged = await kit.auditCount("raffle.box.assign");

    // The helper's board still says $10 a box, and they took $20 for two.
    const stale = await runAs(helper, () =>
      raffles.assignBoxesAction(form({ raffleId: raffle.id, name: "Ann", boxes: "1, 2", paid: "CASH", priceCents: 1000 })),
    );
    assert.match(stale.error ?? "", PRICE_CHANGED);
    assert.deepEqual(await kit.boardOf(raffle.id), []);
    assert.equal(await db.prisma.rafflePayment.count({ where: { raffleId: raffle.id } }), 0);
    assert.equal(await kit.auditCount("raffle.box.assign"), salesLogged);

    // Not paid yet: no money is recorded, and what Ann owes follows the
    // current price on the page, so the old page's price doesn't matter.
    assert.deepEqual(
      await runAs(helper, () => raffles.assignBoxesAction(form({ raffleId: raffle.id, name: "Ann", boxes: "1, 2", priceCents: 1000 }))),
      {},
    );
    // A refreshed page sells at the new price.
    await kit.sell(helper, raffles, raffle.id, "Ben", "3", "ZELLE");
    const payments = await db.prisma.rafflePayment.findMany({ where: { raffleId: raffle.id } });
    assert.deepEqual(payments.map((payment) => payment.amountCents), [2000]);
  });

  it("a paid sale from a page without the price (loaded before this change) is refused as out of date", async () => {
    const raffle = await kit.makeRaffle();
    const old = await runAs(helper, () => raffles.assignBoxesAction(form({ raffleId: raffle.id, name: "Ann", boxes: "1", paid: "CASH" })));
    assert.match(old.error ?? "", /out of date/);
    assert.deepEqual(await kit.boardOf(raffle.id), []);
    // An unpaid sale records no money, so it doesn't need the price.
    assert.deepEqual(await runAs(helper, () => raffles.assignBoxesAction(form({ raffleId: raffle.id, name: "Ann", boxes: "1" }))), {});
  });

  it("adding paid boxes to a buyer's line checks the price the same way; taking boxes away doesn't need it", async () => {
    const raffle = await kit.makeRaffle({ priceCents: 1000 });
    const ann = await kit.sell(helper, raffles, raffle.id, "Ann", "1, 2");
    assert.deepEqual(await runAs(admin, () => raffles.updateRaffleAction(reprice(raffle, "20"))), {});

    const change = (fields: Record<string, string | number | string[]>) =>
      runAs(helper, () => raffles.changeEntryBoxesAction(form({ entryId: ann.id, ...fields })));
    assert.match((await change({ add: "3", paid: "CASH", priceCents: 1000 })).error ?? "", PRICE_CHANGED);
    assert.match((await change({ add: "3", paid: "CASH" })).error ?? "", /out of date/);
    assert.deepEqual(await kit.boardOf(raffle.id), ["1:Ann", "2:Ann"]);
    assert.equal(await db.prisma.rafflePayment.count({ where: { raffleId: raffle.id } }), 0);

    // The board's "take this box away" button sends no price, and records no money.
    assert.deepEqual(await change({ remove: ["2"] }), {});
    assert.deepEqual(await change({ add: "4", priceCents: 1000 }), {}, "unpaid boxes from the old page are fine");
    assert.deepEqual(await change({ add: "5", paid: "ZELLE", priceCents: 2000 }), {});
    assert.deepEqual(await kit.boardOf(raffle.id), ["1:Ann", "4:Ann", "5:Ann"]);
    const payments = await db.prisma.rafflePayment.findMany({ where: { raffleId: raffle.id } });
    assert.deepEqual(payments.map((payment) => [payment.amountCents, payment.method]), [[2000, "ZELLE"]]);
  });

  it("real actions: a price change in flight, then a paid sale from the old page — the sale is refused", async (t) => {
    const raffle = await kit.makeRaffle({ priceCents: 1000 });
    const paused = await kit.pauseUser(admin);
    t.after(() => paused.rollback());
    const repricing = kit.act(admin, () => raffles.updateRaffleAction(reprice(raffle, "20")));
    await kit.waitForWaiters(1);
    const selling = kit.act(helper, () =>
      raffles.assignBoxesAction(form({ raffleId: raffle.id, name: "Ann", boxes: "1, 2", paid: "CASH", priceCents: 1000 })),
    );
    await kit.waitForWaiters(2);
    await paused.commit();

    assert.deepEqual(await kit.resultOf(repricing), {});
    assert.match((await kit.resultOf(selling)).error ?? "", PRICE_CHANGED);
    assert.equal(await db.prisma.rafflePayment.count({ where: { raffleId: raffle.id } }), 0);
    assert.equal((await db.prisma.raffle.findUniqueOrThrow({ where: { id: raffle.id } })).priceCents, 2000);
  });

  it("20 rounds of a paid sale racing a price change: every recorded payment is at the price its page showed", async () => {
    for (let round = 0; round < 20; round++) {
      const raffle = await kit.makeRaffle({ priceCents: 1000 });
      const [sold, repriced] = await Promise.all([
        kit.resultOf(
          kit.act(helper, () =>
            raffles.assignBoxesAction(form({ raffleId: raffle.id, name: "Ann", boxes: "1, 2", paid: "CASH", priceCents: 1000 })),
          ),
        ),
        kit.resultOf(kit.act(admin, () => raffles.updateRaffleAction(reprice(raffle, "20")))),
      ]);
      // Sale first: the price can't change once money is recorded at it.
      // Price first: the sale is refused. Never both, never neither.
      assert.ok(Boolean(sold.error) !== Boolean(repriced.error), `round ${round}: exactly one applies`);
      if (sold.error) assert.match(sold.error, PRICE_CHANGED);
      else assert.match(repriced.error ?? "", /Payments have already been recorded/);
      const final = await db.prisma.raffle.findUniqueOrThrow({ where: { id: raffle.id } });
      const payments = await db.prisma.rafflePayment.findMany({ where: { raffleId: raffle.id } });
      assert.deepEqual(payments.map((payment) => payment.amountCents), sold.error ? [] : [2000]);
      assert.equal(final.priceCents, sold.error ? 2000 : 1000);
    }
  });
});

describe("a payment's Edit form refuses to put back values someone else changed", () => {
  /** A raffle where the helper sold box 1 to Ann for $10 cash; the payment as an Edit form would load it. */
  async function loadedPayment() {
    const raffle = await kit.makeRaffle();
    const ann = await kit.sell(helper, raffles, raffle.id, "Ann", "1", "CASH");
    const payment = await db.prisma.rafflePayment.findFirstOrThrow({ where: { entryId: ann.id } });
    return { raffle, ann, payment };
  }

  const verify = (payment: { id: string }, amountCents: number, method: string) =>
    form({ paymentId: payment.id, verified: "true", amountCents, method });

  it("the review's case: Admin A's open Edit can't undo Admin B's correction and verification", async () => {
    const { payment: shownToA } = await loadedPayment();
    // Admin B corrects the payment to $20 Zelle and ticks it after checking the bank.
    assert.deepEqual(await runAs(admin2, () => raffles.updatePaymentAction(editPaymentForm(shownToA, { amount: "20", method: "ZELLE" }))), {});
    assert.deepEqual(await runAs(admin2, () => raffles.setPaymentVerifiedAction(verify(shownToA, 2000, "ZELLE"))), {});

    // Admin A's Edit box still shows $10 cash; A only adds a note. Before the
    // fix this saved, putting back $10 cash and clearing B's tick.
    const stale = await runAs(admin, () => raffles.updatePaymentAction(editPaymentForm(shownToA, { note: "met at door" })));
    assert.match(stale.error ?? "", PAYMENT_EDIT_STALE);
    assert.match(stale.error ?? "", /now \$20\.00 by zelle for Ann\. Nothing was saved/);

    const final = await db.prisma.rafflePayment.findUniqueOrThrow({ where: { id: shownToA.id } });
    assert.deepEqual([final.amountCents, final.method, final.note, final.verifiedAt !== null], [2000, "ZELLE", null, true]);
    assert.equal(await kit.auditCount("raffle.payment.update", shownToA.id), 1, "only B's correction is in the log");
  });

  it("an Edit opened before a verification still saves; the tick stays unless the amount or method changes", async () => {
    const { payment: shown } = await loadedPayment();
    assert.deepEqual(await runAs(admin2, () => raffles.setPaymentVerifiedAction(verify(shown, 1000, "CASH"))), {});

    assert.deepEqual(await runAs(admin, () => raffles.updatePaymentAction(editPaymentForm(shown, { note: "in the blue envelope" }))), {});
    let final = await db.prisma.rafflePayment.findUniqueOrThrow({ where: { id: shown.id } });
    assert.deepEqual([final.note, final.verifiedAt !== null], ["in the blue envelope", true]);

    // A page reloaded after that save, correcting the amount: the tick goes.
    assert.deepEqual(await runAs(admin, () => raffles.updatePaymentAction(editPaymentForm(final, { amount: "15" }))), {});
    final = await db.prisma.rafflePayment.findUniqueOrThrow({ where: { id: shown.id } });
    assert.deepEqual([final.amountCents, final.verifiedAt], [1500, null]);
  });

  it("an Edit form without the fingerprint (a page from before this change) is refused as out of date", async () => {
    const { payment } = await loadedPayment();
    const old = await runAs(admin, () =>
      raffles.updatePaymentAction(form({ paymentId: payment.id, entryId: payment.entryId, amount: "10", method: "CASH", note: "x" })),
    );
    assert.match(old.error ?? "", /out of date/);
    assert.equal((await db.prisma.rafflePayment.findUniqueOrThrow({ where: { id: payment.id } })).note, null);
  });

  it("real actions, both orders: of two Edits from one page, the first saves and the second is refused", async (t) => {
    // A's edit in flight (paused just before its commit), B's waiting behind it.
    const first = await loadedPayment();
    const pausedA = await kit.pauseUser(admin);
    t.after(() => pausedA.rollback());
    const editA = kit.act(admin, () => raffles.updatePaymentAction(editPaymentForm(first.payment, { amount: "15" })));
    await kit.waitForWaiters(1);
    const editB = kit.act(admin2, () => raffles.updatePaymentAction(editPaymentForm(first.payment, { note: "b" })));
    await kit.waitForWaiters(2);
    await pausedA.commit();
    assert.deepEqual(await kit.resultOf(editA), {});
    assert.match((await kit.resultOf(editB)).error ?? "", PAYMENT_EDIT_STALE);
    let final = await db.prisma.rafflePayment.findUniqueOrThrow({ where: { id: first.payment.id } });
    assert.deepEqual([final.amountCents, final.note], [1500, null]);

    // The other way round.
    const second = await loadedPayment();
    const pausedB = await kit.pauseUser(admin2);
    t.after(() => pausedB.rollback());
    const editB2 = kit.act(admin2, () => raffles.updatePaymentAction(editPaymentForm(second.payment, { note: "b" })));
    await kit.waitForWaiters(1);
    const editA2 = kit.act(admin, () => raffles.updatePaymentAction(editPaymentForm(second.payment, { amount: "15" })));
    await kit.waitForWaiters(2);
    await pausedB.commit();
    assert.deepEqual(await kit.resultOf(editB2), {});
    assert.match((await kit.resultOf(editA2)).error ?? "", PAYMENT_EDIT_STALE);
    final = await db.prisma.rafflePayment.findUniqueOrThrow({ where: { id: second.payment.id } });
    assert.deepEqual([final.amountCents, final.note], [1000, "b"]);
  });

  it("a correction written outside the raffle lock is still caught by the save's conditional write", async (t) => {
    const { payment } = await loadedPayment();
    // Its check under the raffle lock still reads the old, committed amount;
    // only the UPDATE's own WHERE clause can see this one once it commits.
    const correction = await openTransaction(db.pool);
    t.after(() => correction.rollback());
    await correction.query(`UPDATE "RafflePayment" SET "amountCents" = 1500 WHERE id = $1`, [payment.id]);

    const saving = kit.act(admin, () => raffles.updatePaymentAction(editPaymentForm(payment, { note: "late" })));
    await kit.waitForWaiters(1);
    await correction.commit();

    assert.match((await kit.resultOf(saving)).error ?? "", /changed a moment ago/);
    const final = await db.prisma.rafflePayment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.deepEqual([final.amountCents, final.note], [1500, null]);
    assert.equal(await kit.auditCount("raffle.payment.update", payment.id), 0);
  });

  it("20 rounds of two Edits from one page: exactly one lands, whole", async () => {
    for (let round = 0; round < 20; round++) {
      const { payment } = await loadedPayment();
      const [a, b] = await Promise.all([
        kit.resultOf(kit.act(admin, () => raffles.updatePaymentAction(editPaymentForm(payment, { amount: "15", note: "a" })))),
        kit.resultOf(kit.act(admin2, () => raffles.updatePaymentAction(editPaymentForm(payment, { method: "ZELLE", note: "b" })))),
      ]);
      assert.ok(Boolean(a.error) !== Boolean(b.error), `round ${round}: exactly one saved`);
      assert.match((a.error ?? b.error) as string, PAYMENT_EDIT_STALE);
      const final = await db.prisma.rafflePayment.findUniqueOrThrow({ where: { id: payment.id } });
      const landed = [final.amountCents, final.method, final.note];
      assert.deepEqual(landed, a.error ? [1000, "ZELLE", "b"] : [1500, "CASH", "a"], `round ${round}: not a mix of the two`);
      assert.equal(await kit.auditCount("raffle.payment.update", payment.id), 1);
    }
  });
});

describe("a buyer's Edit form refuses to put back a name someone else changed", () => {
  it("a stale Edit after a rename is refused; the rename stands", async () => {
    const raffle = await kit.makeRaffle();
    const shown = await kit.sell(helper, raffles, raffle.id, "Ann", "1");
    assert.deepEqual(await runAs(helper2, () => raffles.updateEntryAction(editEntryForm(shown, { name: "Ann Lee" }))), {});

    // The first helper's Edit box still says "Ann"; they add a note.
    const stale = await runAs(helper, () => raffles.updateEntryAction(editEntryForm(shown, { notes: "pays Friday" })));
    assert.match(stale.error ?? "", /changed this buyer's name or notes after this page loaded \(they're now listed as Ann Lee\)/);
    const final = await db.prisma.raffleEntry.findUniqueOrThrow({ where: { id: shown.id } });
    assert.deepEqual([final.name, final.notes], ["Ann Lee", null]);

    const old = await runAs(helper, () => raffles.updateEntryAction(form({ entryId: shown.id, name: "Ann", notes: "x" })));
    assert.match(old.error ?? "", /out of date/);
  });

  it("selling more boxes to a buyer doesn't make their open Edit form stale", async () => {
    const raffle = await kit.makeRaffle();
    const shown = await kit.sell(helper, raffles, raffle.id, "Ann", "1");
    assert.deepEqual(
      await runAs(helper2, () => raffles.assignBoxesAction(form({ raffleId: raffle.id, name: "ann", boxes: "2", paid: "CASH", priceCents: 1000 }))),
      {},
    );
    assert.deepEqual(await kit.boardOf(raffle.id), ["1:Ann", "2:Ann"]);
    assert.deepEqual(await runAs(helper, () => raffles.updateEntryAction(editEntryForm(shown, { notes: "two boxes" }))), {});
  });

  it("20 rounds of two Edits of one buyer from one page: exactly one lands, whole", async () => {
    for (let round = 0; round < 20; round++) {
      const raffle = await kit.makeRaffle();
      const shown = await kit.sell(helper, raffles, raffle.id, "Ann", "1");
      const [a, b] = await Promise.all([
        kit.resultOf(kit.act(helper, () => raffles.updateEntryAction(editEntryForm(shown, { name: "Ann Lee", notes: "a" })))),
        kit.resultOf(kit.act(helper2, () => raffles.updateEntryAction(editEntryForm(shown, { notes: "b" })))),
      ]);
      assert.ok(Boolean(a.error) !== Boolean(b.error), `round ${round}: exactly one saved`);
      const final = await db.prisma.raffleEntry.findUniqueOrThrow({ where: { id: shown.id } });
      assert.deepEqual([final.name, final.notes], a.error ? ["Ann", "b"] : ["Ann Lee", "a"], `round ${round}`);
      assert.equal(await kit.auditCount("raffle.entry.update", shown.id), 1);
    }
  });
});
