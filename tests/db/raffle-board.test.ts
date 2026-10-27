/*
 * F3 (security review 2026-10-27): the raffle board — sales, box changes,
 * buyer removal — against the drawing, closing, term edits and payments, on a
 * real Postgres with the races forced in a known order (raffle-support.ts).
 *
 * The invariant the review found broken: once the winner is recorded, the
 * prize is winner's share x boxes sold x price, and the board can't change
 * underneath it. More generally, every final state here must be one that some
 * serial order of the two changes would produce.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { openTransaction, withTestDatabase } from "../support/db";
import { form, runAs } from "../support/context";
import { editEntryForm, newId, raffleTestKit, type RaffleActions, type TestUser } from "./raffle-support";
import { prizeForSales } from "@/lib/raffleMath";
import { raffleTermsVersion } from "@/lib/raffleEditVersion";

const db = withTestDatabase("raffle_board");
const kit = raffleTestKit(db);
let raffles: RaffleActions;
let admin: TestUser;
let helper: TestUser;
let helper2: TestUser;

before(async () => {
  await db.ready;
  raffles = await import("@/lib/actions/raffles");
  admin = await kit.makeUser("ADMIN");
  helper = await kit.makeUser("DEN", { raffleHelper: true });
  helper2 = await kit.makeUser("PARENT", { raffleHelper: true });
});

/** A sale from a board page loaded when `raffle` was read: it carries the price per box that page showed. */
const sale = (raffle: { id: string; priceCents: number }, name: string, boxes: string, paid = "") =>
  form({ raffleId: raffle.id, name, boxes, paid, priceCents: raffle.priceCents });
const winner = (raffleId: string, winningBox: number) => form({ raffleId, winningBox });

/** The prize recorded on the raffle agrees with the boxes on its board. */
async function assertPrizeMatchesBoard(raffleId: string, message?: string) {
  const raffle = await db.prisma.raffle.findUniqueOrThrow({ where: { id: raffleId } });
  const sold = await db.prisma.raffleBox.count({ where: { raffleId } });
  assert.notEqual(raffle.prizeCents, null, "a winner is recorded");
  assert.equal(raffle.prizeCents, prizeForSales(sold, raffle.priceCents, raffle.prizePercent), message);
  if (raffle.winningBox !== null) {
    const box = await db.prisma.raffleBox.findUnique({ where: { raffleId_number: { raffleId, number: raffle.winningBox } } });
    assert.ok(box, "the winning box is still on the board");
  }
  return { raffle, sold };
}

/** The raffle-lock holder recording a winner the way recordWinnerAction does, from the current board. */
async function holdWinner(raffleId: string, winningBox: number) {
  const holder = await kit.holdRaffle(raffleId);
  const { rows } = await holder.query(
    `SELECT count(*)::int AS sold, r."priceCents", r."prizePercent"
       FROM "Raffle" r LEFT JOIN "RaffleBox" b ON b."raffleId" = r.id
      WHERE r.id = $1 GROUP BY r.id`,
    [raffleId],
  );
  const prize = prizeForSales(rows[0].sold, rows[0].priceCents, rows[0].prizePercent);
  await holder.query(`UPDATE "Raffle" SET "winningBox" = $2, "winnerName" = 'Winner', "prizeCents" = $3 WHERE id = $1`, [
    raffleId,
    winningBox,
    prize,
  ]);
  return holder;
}

describe("sale vs recording the winner", () => {
  it("a sale waiting behind the drawing is refused, so the frozen prize matches the board", async (t) => {
    const raffle = await kit.makeRaffle({ priceCents: 1000, prizePercent: 50 });
    await kit.sell(helper, raffles, raffle.id, "Ann", "1");
    const drawing = await holdWinner(raffle.id, 1);
    t.after(() => drawing.rollback());

    // Before the fix this sale read "no winner" and then inserted its box
    // after the drawing committed: $5 prize, $20 board.
    const selling = kit.act(helper, () => raffles.assignBoxesAction(sale(raffle, "Bob", "2")));
    await kit.waitForWaiters(1);
    await drawing.commit();

    assert.match((await kit.resultOf(selling)).error ?? "", /winner is already recorded/);
    assert.deepEqual(await kit.boardOf(raffle.id), ["1:Ann"]);
    const { raffle: final } = await assertPrizeMatchesBoard(raffle.id);
    assert.equal(final.prizeCents, 500);
    assert.equal(await db.prisma.raffleEntry.count({ where: { raffleId: raffle.id, name: "Bob" } }), 0, "no empty buyer left behind");
  });

  it("real actions, drawing first: the sale is refused", async (t) => {
    const raffle = await kit.makeRaffle();
    await kit.sell(helper, raffles, raffle.id, "Ann", "1");
    const paused = await kit.pauseUser(admin);
    t.after(() => paused.rollback());
    const drawing = kit.act(admin, () => raffles.recordWinnerAction(winner(raffle.id, 1)));
    await kit.waitForWaiters(1);
    const selling = kit.act(helper, () => raffles.assignBoxesAction(sale(raffle, "Bob", "2", "CASH")));
    await kit.waitForWaiters(2);
    await paused.commit();

    assert.deepEqual(await kit.resultOf(drawing), {});
    assert.match((await kit.resultOf(selling)).error ?? "", /winner is already recorded/);
    await assertPrizeMatchesBoard(raffle.id);
    assert.equal(await db.prisma.rafflePayment.count({ where: { raffleId: raffle.id } }), 0, "the refused sale's payment wasn't recorded");
  });

  it("real actions, sale first: the drawing counts the new box", async (t) => {
    const raffle = await kit.makeRaffle();
    await kit.sell(helper, raffles, raffle.id, "Ann", "1");
    const paused = await kit.pauseUser(helper);
    t.after(() => paused.rollback());
    const selling = kit.act(helper, () => raffles.assignBoxesAction(sale(raffle, "Bob", "2")));
    await kit.waitForWaiters(1);
    const drawing = kit.act(admin, () => raffles.recordWinnerAction(winner(raffle.id, 1)));
    await kit.waitForWaiters(2);
    await paused.commit();

    assert.deepEqual(await kit.resultOf(selling), {});
    assert.deepEqual(await kit.resultOf(drawing), {});
    const { raffle: final } = await assertPrizeMatchesBoard(raffle.id);
    assert.equal(final.prizeCents, 1000);
  });

  it("20 rounds of a sale racing the drawing always leave prize and board in agreement", async () => {
    for (let round = 0; round < 20; round++) {
      const raffle = await kit.makeRaffle({ priceCents: 500, prizePercent: 50 });
      await kit.sell(helper, raffles, raffle.id, "Ann", "1");
      const [sold, drawn] = await Promise.all([
        kit.resultOf(kit.act(helper, () => raffles.assignBoxesAction(sale(raffle, "Bob", "2, 3", "ZELLE")))),
        kit.resultOf(kit.act(admin, () => raffles.recordWinnerAction(winner(raffle.id, 1)))),
      ]);
      assert.deepEqual(drawn, {});
      const { sold: boxes } = await assertPrizeMatchesBoard(raffle.id, `round ${round}`);
      assert.equal(boxes, sold.error ? 1 : 3);
    }
  });
});

describe("sale vs closing", () => {
  it("a sale waiting behind the close is refused", async (t) => {
    const raffle = await kit.makeRaffle();
    const closing = await kit.holdRaffle(raffle.id);
    t.after(() => closing.rollback());
    await closing.query(`UPDATE "Raffle" SET status = 'CLOSED', "closedAt" = now() WHERE id = $1`, [raffle.id]);

    const selling = kit.act(helper, () => raffles.assignBoxesAction(sale(raffle, "Ann", "4", "CASH")));
    await kit.waitForWaiters(1);
    await closing.commit();

    assert.match((await kit.resultOf(selling)).error ?? "", /closed/);
    assert.deepEqual(await kit.boardOf(raffle.id), []);
    assert.equal(await db.prisma.rafflePayment.count({ where: { raffleId: raffle.id } }), 0);
  });

  it("20 rounds of a sale and a payment racing the close", async () => {
    for (let round = 0; round < 20; round++) {
      const raffle = await kit.makeRaffle();
      const ann = await kit.sell(helper, raffles, raffle.id, "Ann", "1");
      const [sold, paid, closed] = await Promise.all([
        kit.resultOf(kit.act(helper, () => raffles.assignBoxesAction(sale(raffle, "Bob", "2")))),
        kit.resultOf(
          kit.act(helper2, () => raffles.recordPaymentAction(form({ raffleId: raffle.id, entryId: ann.id, amount: "10", method: "CASH" }))),
        ),
        kit.resultOf(kit.act(admin, () => raffles.closeRaffleAction(form({ raffleId: raffle.id })))),
      ]);
      assert.deepEqual(closed, {});
      const final = await db.prisma.raffle.findUniqueOrThrow({ where: { id: raffle.id } });
      assert.equal(final.status, "CLOSED");
      // Whatever didn't land before the close was refused as "closed", and nothing landed after.
      for (const result of [sold, paid]) if (result.error) assert.match(result.error, /closed/);
      assert.equal(await db.prisma.raffleBox.count({ where: { raffleId: raffle.id } }), sold.error ? 1 : 2);
      assert.equal(await db.prisma.rafflePayment.count({ where: { raffleId: raffle.id } }), paid.error ? 0 : 1);
    }
  });

  it("closing twice and reopening twice are each recorded once", async () => {
    const raffle = await kit.makeRaffle();
    const closes = await Promise.all([1, 2].map(() => kit.resultOf(kit.act(admin, () => raffles.closeRaffleAction(form({ raffleId: raffle.id }))))));
    assert.deepEqual(closes, [{}, {}]);
    assert.equal(await kit.auditCount("raffle.close", raffle.id), 1);
    const reopens = await Promise.all([1, 2].map(() => kit.resultOf(kit.act(admin, () => raffles.reopenRaffleAction(form({ raffleId: raffle.id }))))));
    assert.deepEqual(reopens, [{}, {}]);
    assert.equal(await kit.auditCount("raffle.reopen", raffle.id), 1);
  });
});

describe("drawing vs taking boxes off the board", () => {
  it("removing a buyer waiting behind the drawing is refused; the winning box stays", async (t) => {
    const raffle = await kit.makeRaffle();
    await kit.sell(helper, raffles, raffle.id, "Ann", "1");
    const bob = await kit.sell(helper, raffles, raffle.id, "Bob", "2");
    const drawing = await holdWinner(raffle.id, 2);
    t.after(() => drawing.rollback());

    const removing = kit.act(helper, () => raffles.removeEntryAction(form({ entryId: bob.id })));
    await kit.waitForWaiters(1);
    await drawing.commit();

    assert.match((await kit.resultOf(removing)).error ?? "", /board is locked/);
    assert.deepEqual(await kit.boardOf(raffle.id), ["1:Ann", "2:Bob"]);
    await assertPrizeMatchesBoard(raffle.id);
  });

  it("taking one box away waiting behind the drawing is refused", async (t) => {
    const raffle = await kit.makeRaffle();
    const ann = await kit.sell(helper, raffles, raffle.id, "Ann", "1, 2");
    const drawing = await holdWinner(raffle.id, 1);
    t.after(() => drawing.rollback());

    const changing = kit.act(helper, () => raffles.changeEntryBoxesAction(form({ entryId: ann.id, remove: ["2"] })));
    await kit.waitForWaiters(1);
    await drawing.commit();

    assert.match((await kit.resultOf(changing)).error ?? "", /board is locked/);
    await assertPrizeMatchesBoard(raffle.id);
  });

  it("real actions, removal first: the drawing can't pick the removed buyer's box", async (t) => {
    const raffle = await kit.makeRaffle();
    await kit.sell(helper, raffles, raffle.id, "Ann", "1");
    const bob = await kit.sell(helper, raffles, raffle.id, "Bob", "2");
    const paused = await kit.pauseUser(helper);
    t.after(() => paused.rollback());
    const removing = kit.act(helper, () => raffles.removeEntryAction(form({ entryId: bob.id })));
    await kit.waitForWaiters(1);
    const drawing = kit.act(admin, () => raffles.recordWinnerAction(winner(raffle.id, 2)));
    await kit.waitForWaiters(2);
    await paused.commit();

    assert.deepEqual(await kit.resultOf(removing), {});
    assert.match((await kit.resultOf(drawing)).error ?? "", /Box 2 wasn't sold/);
    const final = await db.prisma.raffle.findUniqueOrThrow({ where: { id: raffle.id } });
    assert.equal(final.winningBox, null);
  });

  it("20 rounds of a removal racing the drawing on another box", async () => {
    for (let round = 0; round < 20; round++) {
      const raffle = await kit.makeRaffle();
      await kit.sell(helper, raffles, raffle.id, "Ann", "1");
      const bob = await kit.sell(helper, raffles, raffle.id, "Bob", "2, 3");
      const [removed, drawn] = await Promise.all([
        kit.resultOf(kit.act(helper, () => raffles.removeEntryAction(form({ entryId: bob.id })))),
        kit.resultOf(kit.act(admin, () => raffles.recordWinnerAction(winner(raffle.id, 1)))),
      ]);
      assert.deepEqual(drawn, {});
      const { sold } = await assertPrizeMatchesBoard(raffle.id, `round ${round}`);
      assert.equal(sold, removed.error ? 3 : 1);
    }
  });
});

describe("term changes vs sales", () => {
  it("a sale of a box past a board just made smaller is refused", async (t) => {
    const raffle = await kit.makeRaffle({ boxCount: 20 });
    const shrinking = await kit.holdRaffle(raffle.id);
    t.after(() => shrinking.rollback());
    await shrinking.query(`UPDATE "Raffle" SET "boxCount" = 10 WHERE id = $1`, [raffle.id]);

    const selling = kit.act(helper, () => raffles.assignBoxesAction(sale(raffle, "Ann", "15")));
    await kit.waitForWaiters(1);
    await shrinking.commit();

    assert.match((await kit.resultOf(selling)).error ?? "", /only goes up to 10/);
    assert.deepEqual(await kit.boardOf(raffle.id), []);
  });

  it("a paid sale waiting behind a price change is refused: the seller collected the old price", async (t) => {
    const raffle = await kit.makeRaffle({ priceCents: 1000 });
    const repricing = await kit.holdRaffle(raffle.id);
    t.after(() => repricing.rollback());
    await repricing.query(`UPDATE "Raffle" SET "priceCents" = 2000 WHERE id = $1`, [raffle.id]);

    // The seller's page showed $10 a box and they took $20 for two. The first
    // version of the fix recorded $40 here — money that never arrived.
    const selling = kit.act(helper, () => raffles.assignBoxesAction(sale(raffle, "Ann", "3, 4", "CASH")));
    await kit.waitForWaiters(1);
    await repricing.commit();

    assert.match((await kit.resultOf(selling)).error ?? "", /price per box changed from \$10\.00 to \$20\.00 after this page loaded/);
    assert.deepEqual(await kit.boardOf(raffle.id), []);
    assert.equal(await db.prisma.rafflePayment.count({ where: { raffleId: raffle.id } }), 0);
  });

  it("real actions, sale first: the shrink and the price change are refused", async (t) => {
    const raffle = await kit.makeRaffle({ boxCount: 20, priceCents: 1000 });
    const paused = await kit.pauseUser(helper);
    t.after(() => paused.rollback());
    const selling = kit.act(helper, () => raffles.assignBoxesAction(sale(raffle, "Ann", "15", "CASH")));
    await kit.waitForWaiters(1);
    const editing = kit.act(admin, () =>
      raffles.updateRaffleAction(form({ raffleId: raffle.id, name: raffle.name, boxCount: 10, price: "10", prizePercent: 50, version: raffleTermsVersion(raffle) })),
    );
    const repricing = kit.act(admin, () =>
      raffles.updateRaffleAction(form({ raffleId: raffle.id, name: raffle.name, boxCount: 20, price: "20", prizePercent: 50, version: raffleTermsVersion(raffle) })),
    );
    await kit.waitForWaiters(3);
    await paused.commit();

    assert.deepEqual(await kit.resultOf(selling), {});
    assert.match((await kit.resultOf(editing)).error ?? "", /Box 15 is already sold/);
    assert.match((await kit.resultOf(repricing)).error ?? "", /Payments have already been recorded/);
    const final = await db.prisma.raffle.findUniqueOrThrow({ where: { id: raffle.id } });
    assert.deepEqual([final.boxCount, final.priceCents], [20, 1000]);
  });

  it("20 rounds of a sale racing a shrink, and a paid sale racing a price change", async () => {
    for (let round = 0; round < 20; round++) {
      const raffle = await kit.makeRaffle({ boxCount: 20, priceCents: 1000 });
      const [sold, edited] = await Promise.all([
        kit.resultOf(kit.act(helper, () => raffles.assignBoxesAction(sale(raffle, "Ann", "15, 16", "CASH")))),
        kit.resultOf(
          kit.act(admin, () =>
            raffles.updateRaffleAction(form({ raffleId: raffle.id, name: raffle.name, boxCount: 10, price: "20", prizePercent: 50, version: raffleTermsVersion(raffle) })),
          ),
        ),
      ]);
      assert.ok(Boolean(sold.error) !== Boolean(edited.error), `round ${round}: exactly one of the two applies`);
      if (sold.error) assert.match(sold.error, /price per box changed/, `round ${round}`);
      const final = await db.prisma.raffle.findUniqueOrThrow({ where: { id: raffle.id } });
      const highest = await db.prisma.raffleBox.findFirst({ where: { raffleId: raffle.id }, orderBy: { number: "desc" } });
      assert.ok(!highest || highest.number <= final.boxCount, `round ${round}: a box off the board`);
      for (const payment of await db.prisma.rafflePayment.findMany({ where: { raffleId: raffle.id } })) {
        assert.equal(payment.amountCents, 2 * final.priceCents, `round ${round}: paid at a price that isn't the raffle's`);
      }
    }
  });
});

describe("removing a buyer vs recording their payment", () => {
  it("a payment being recorded for the buyer stops the removal; nothing is orphaned", async (t) => {
    const raffle = await kit.makeRaffle();
    const ann = await kit.sell(helper, raffles, raffle.id, "Ann", "1");
    // A payment insert in flight. Before the fix the removal checked for
    // payments outside its delete, then the delete's SetNull cut this payment
    // loose from Ann with no name on it.
    const paying = await openTransaction(db.pool);
    t.after(() => paying.rollback());
    await paying.query(
      `INSERT INTO "RafflePayment" (id, "raffleId", "entryId", method, "amountCents", "recordedByUserId")
       VALUES ($1, $2, $3, 'CASH', 1000, $4)`,
      [newId("pay"), raffle.id, ann.id, admin.id],
    );

    const removing = kit.act(helper, () => raffles.removeEntryAction(form({ entryId: ann.id })));
    await kit.waitForWaiters(1);
    await paying.commit();

    assert.match((await kit.resultOf(removing)).error ?? "", /Ann has \$10\.00 in payments recorded/);
    const payment = await db.prisma.rafflePayment.findFirstOrThrow({ where: { raffleId: raffle.id } });
    assert.equal(payment.entryId, ann.id);
    assert.deepEqual(await kit.boardOf(raffle.id), ["1:Ann"]);
  });

  it("a payment for a buyer whose removal is in flight is refused with a message", async (t) => {
    const raffle = await kit.makeRaffle();
    const ann = await kit.sell(helper, raffles, raffle.id, "Ann", "1");
    const removal = await kit.holdRaffle(raffle.id);
    t.after(() => removal.rollback());
    await removal.query(`DELETE FROM "RaffleEntry" WHERE id = $1`, [ann.id]);

    const paying = kit.act(helper2, () =>
      raffles.recordPaymentAction(form({ raffleId: raffle.id, entryId: ann.id, amount: "10", method: "CASH" })),
    );
    await kit.waitForWaiters(1);
    await removal.commit();

    assert.match((await kit.resultOf(paying)).error ?? "", /isn't on this raffle any more/);
    assert.equal(await db.prisma.rafflePayment.count({ where: { raffleId: raffle.id } }), 0);
  });

  it("real actions in both orders", async (t) => {
    // Removal first: the payment is refused.
    const first = await kit.makeRaffle();
    const ann = await kit.sell(helper, raffles, first.id, "Ann", "1");
    const pausedHelper = await kit.pauseUser(helper);
    t.after(() => pausedHelper.rollback());
    const removing = kit.act(helper, () => raffles.removeEntryAction(form({ entryId: ann.id })));
    await kit.waitForWaiters(1);
    const paying = kit.act(admin, () => raffles.recordPaymentAction(form({ raffleId: first.id, entryId: ann.id, amount: "10", method: "CASH" })));
    await kit.waitForWaiters(2);
    await pausedHelper.commit();
    assert.deepEqual(await kit.resultOf(removing), {});
    assert.match((await kit.resultOf(paying)).error ?? "", /isn't on this raffle any more/);
    assert.equal(await db.prisma.rafflePayment.count({ where: { raffleId: first.id } }), 0);

    // Payment first: the removal is refused.
    const second = await kit.makeRaffle();
    const bea = await kit.sell(helper, raffles, second.id, "Bea", "1");
    const pausedAdmin = await kit.pauseUser(admin);
    t.after(() => pausedAdmin.rollback());
    const paying2 = kit.act(admin, () => raffles.recordPaymentAction(form({ raffleId: second.id, entryId: bea.id, amount: "10", method: "ZELLE" })));
    await kit.waitForWaiters(1);
    const removing2 = kit.act(helper, () => raffles.removeEntryAction(form({ entryId: bea.id })));
    await kit.waitForWaiters(2);
    await pausedAdmin.commit();
    assert.deepEqual(await kit.resultOf(paying2), {});
    assert.match((await kit.resultOf(removing2)).error ?? "", /in payments recorded/);
    assert.equal((await db.prisma.rafflePayment.findFirstOrThrow({ where: { raffleId: second.id } })).entryId, bea.id);
  });

  it("20 rounds: no payment ever ends up with neither a buyer nor a name", async () => {
    for (let round = 0; round < 20; round++) {
      const raffle = await kit.makeRaffle();
      const ann = await kit.sell(helper, raffles, raffle.id, "Ann", "1");
      const [removed, paid] = await Promise.all([
        kit.resultOf(kit.act(helper, () => raffles.removeEntryAction(form({ entryId: ann.id })))),
        kit.resultOf(kit.act(admin, () => raffles.recordPaymentAction(form({ raffleId: raffle.id, entryId: ann.id, amount: "10", method: "CASH" })))),
      ]);
      assert.ok(Boolean(removed.error) !== Boolean(paid.error), `round ${round}: exactly one applies`);
      const payments = await db.prisma.rafflePayment.findMany({ where: { raffleId: raffle.id } });
      const annStillThere = (await db.prisma.raffleEntry.count({ where: { id: ann.id } })) === 1;
      assert.equal(annStillThere, Boolean(removed.error));
      assert.equal(payments.length, paid.error ? 0 : 1);
      for (const payment of payments) assert.equal(payment.entryId, ann.id);
    }
  });

  it("a removed buyer's voided payments keep their name", async () => {
    const raffle = await kit.makeRaffle();
    const ann = await kit.sell(helper, raffles, raffle.id, "Ann", "1", "CASH");
    const payment = await db.prisma.rafflePayment.findFirstOrThrow({ where: { entryId: ann.id } });
    assert.deepEqual(await runAs(helper, () => raffles.voidPaymentAction(form({ paymentId: payment.id, reason: "wrong buyer" }))), {});
    assert.deepEqual(await runAs(helper, () => raffles.removeEntryAction(form({ entryId: ann.id }))), {});
    const after = await db.prisma.rafflePayment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.deepEqual([after.entryId, after.payerName], [null, "Ann"]);
    assert.equal(await kit.auditCount("raffle.entry.remove", ann.id), 1);
  });
});

describe("buyers are one line per name", () => {
  it("a sale waiting behind another sale to the same name joins that buyer's line", async (t) => {
    const raffle = await kit.makeRaffle();
    // The first sale's transaction: lock, new buyer, their box.
    const firstSale = await kit.holdRaffle(raffle.id);
    t.after(() => firstSale.rollback());
    const frankId = newId("entry");
    await firstSale.query(`INSERT INTO "RaffleEntry" (id, "raffleId", name) VALUES ($1, $2, 'Frank Smith')`, [frankId, raffle.id]);
    await firstSale.query(`INSERT INTO "RaffleBox" (id, "raffleId", "entryId", number) VALUES ($1, $2, $3, 1)`, [newId("box"), raffle.id, frankId]);

    const selling = kit.act(helper2, () => raffles.assignBoxesAction(sale(raffle, " frank SMITH ", "2")));
    await kit.waitForWaiters(1);
    await firstSale.commit();

    assert.deepEqual(await kit.resultOf(selling), {});
    assert.deepEqual(await kit.boardOf(raffle.id), ["1:Frank Smith", "2:Frank Smith"]);
    assert.equal(await db.prisma.raffleEntry.count({ where: { raffleId: raffle.id } }), 1);
  });

  it("20 rounds of two sales to one name (different capitalization, accents included) make one buyer", async () => {
    for (let round = 0; round < 20; round++) {
      const raffle = await kit.makeRaffle();
      // On a database created with the "C" locale (like this test server)
      // Postgres's lower() leaves "É" and "Í" alone; the first version of the
      // fix compared names with it and made two buyers here.
      const results = await Promise.all([
        kit.resultOf(kit.act(helper, () => raffles.assignBoxesAction(sale(raffle, "José Díaz", "1", "CASH")))),
        kit.resultOf(kit.act(helper2, () => raffles.assignBoxesAction(sale(raffle, "JOSÉ DÍAZ", "2")))),
      ]);
      assert.deepEqual(results, [{}, {}]);
      const entries = await db.prisma.raffleEntry.findMany({ where: { raffleId: raffle.id }, include: { boxes: true } });
      assert.equal(entries.length, 1, `round ${round}: one buyer`);
      assert.equal(entries[0].boxes.length, 2);
    }
  });

  it("20 rounds of a rename racing a sale to that name never leave two buyers with it", async () => {
    for (let round = 0; round < 20; round++) {
      const raffle = await kit.makeRaffle();
      const ann = await kit.sell(helper, raffles, raffle.id, "Ann", "1");
      const [renamed, sold] = await Promise.all([
        kit.resultOf(kit.act(helper, () => raffles.updateEntryAction(editEntryForm(ann, { name: "Frank R." })))),
        kit.resultOf(kit.act(helper2, () => raffles.assignBoxesAction(sale(raffle, "frank r.", "2")))),
      ]);
      assert.deepEqual(sold, {});
      const named = await db.prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM "RaffleEntry" WHERE "raffleId" = ${raffle.id} AND lower(btrim(name)) = 'frank r.'`;
      assert.equal(named[0].n, 1, `round ${round}`);
      if (renamed.error) assert.match(renamed.error, /already a buyer named frank r\./);
    }
  });

  it("namesakes with distinguishing names stay separate; wildcards match nobody", async () => {
    const raffle = await kit.makeRaffle();
    await kit.sell(helper, raffles, raffle.id, "Frank Smith", "1");
    await kit.sell(helper, raffles, raffle.id, "Frank Jones", "2");
    // Prisma's insensitive equals is an ILIKE; "Fr%" used to land on a Frank's line.
    await kit.sell(helper, raffles, raffle.id, "Fr%", "3");
    await kit.sell(helper, raffles, raffle.id, "Frank_Smith", "4");
    assert.deepEqual(await kit.boardOf(raffle.id), ["1:Frank Smith", "2:Frank Jones", "3:Fr%", "4:Frank_Smith"]);

    const jones = await db.prisma.raffleEntry.findFirstOrThrow({ where: { raffleId: raffle.id, name: "Frank Jones" } });
    const clash = await runAs(helper, () => raffles.updateEntryAction(editEntryForm(jones, { name: "FRANK SMITH" })));
    assert.match(clash.error ?? "", /already a buyer named Frank Smith/);
    assert.deepEqual(await runAs(helper, () => raffles.updateEntryAction(editEntryForm(jones, { name: "Frank J." }))), {});
  });

  it("accented capitals, and an accent typed as a separate mark, are the same buyer", async () => {
    const raffle = await kit.makeRaffle();
    const jose = await kit.sell(helper, raffles, raffle.id, "José Díaz", "1");
    // Capitals, and "e" followed by a combining accent (some phones and pasted text send that).
    for (const [name, box] of [["JOSÉ DÍAZ", "2"], ["  jose\u0301 di\u0301az ", "3"]]) {
      assert.deepEqual(await runAs(helper2, () => raffles.assignBoxesAction(sale(raffle, name, box))), {}, name);
    }
    assert.deepEqual(await kit.boardOf(raffle.id), ["1:José Díaz", "2:José Díaz", "3:José Díaz"]);
    assert.equal(await db.prisma.raffleEntry.count({ where: { raffleId: raffle.id } }), 1);

    // Edit refuses the same name in capitals for another buyer, too.
    const maria = await kit.sell(helper, raffles, raffle.id, "María", "4");
    const clash = await runAs(helper, () => raffles.updateEntryAction(editEntryForm(maria, { name: "JOSÉ DÍAZ" })));
    assert.match(clash.error ?? "", /already a buyer named José Díaz/);
    // Renaming a buyer to their own name in other capitals is fine.
    assert.deepEqual(await runAs(helper, () => raffles.updateEntryAction(editEntryForm(jose, { name: "José DÍAZ" }))), {});
    // And a real namesake is told apart by a last name or initial.
    assert.deepEqual(await runAs(helper, () => raffles.assignBoxesAction(sale(raffle, "José R.", "5"))), {});
    assert.equal(await db.prisma.raffleEntry.count({ where: { raffleId: raffle.id } }), 3);
  });

  it("the database refuses a second buyer with the same name on one raffle", async () => {
    const raffle = await kit.makeRaffle();
    await kit.sell(helper, raffles, raffle.id, "Dana", "1");
    await assert.rejects(
      db.pool.query(`INSERT INTO "RaffleEntry" (id, "raffleId", name) VALUES ($1, $2, ' DANA ')`, [newId("entry"), raffle.id]),
      /RaffleEntry_raffleId_name_key/,
    );
    // Another raffle may have its own Dana.
    const other = await kit.makeRaffle();
    await kit.sell(helper, raffles, other.id, "Dana", "1");
  });
});

describe("two sales of one box", () => {
  it("a sale waiting behind another sale of the same box names who got it", async (t) => {
    const raffle = await kit.makeRaffle();
    const firstSale = await kit.holdRaffle(raffle.id);
    t.after(() => firstSale.rollback());
    const annId = newId("entry");
    await firstSale.query(`INSERT INTO "RaffleEntry" (id, "raffleId", name) VALUES ($1, $2, 'Ann')`, [annId, raffle.id]);
    await firstSale.query(`INSERT INTO "RaffleBox" (id, "raffleId", "entryId", number) VALUES ($1, $2, $3, 5)`, [newId("box"), raffle.id, annId]);

    const selling = kit.act(helper, () => raffles.assignBoxesAction(sale(raffle, "Bob", "5", "CASH")));
    await kit.waitForWaiters(1);
    await firstSale.commit();

    assert.match((await kit.resultOf(selling)).error ?? "", /Already taken: box 5 \(Ann\)/);
    assert.deepEqual(await kit.boardOf(raffle.id), ["5:Ann"]);
    assert.equal(await db.prisma.raffleEntry.count({ where: { raffleId: raffle.id, name: "Bob" } }), 0);
    assert.equal(await db.prisma.rafflePayment.count({ where: { raffleId: raffle.id } }), 0);
  });

  it("20 rounds of two sales (and a box change) of one box: exactly one gets it", async () => {
    for (let round = 0; round < 20; round++) {
      const raffle = await kit.makeRaffle();
      const cal = await kit.sell(admin, raffles, raffle.id, "Cal", "9");
      const results = await Promise.all([
        kit.resultOf(kit.act(helper, () => raffles.assignBoxesAction(sale(raffle, "Ann", "5", "CASH")))),
        kit.resultOf(kit.act(helper2, () => raffles.assignBoxesAction(sale(raffle, "Bob", "5, 6", "ZELLE")))),
        kit.resultOf(kit.act(admin, () => raffles.changeEntryBoxesAction(form({ entryId: cal.id, add: "5" })))),
      ]);
      assert.equal(results.filter((result) => !result.error).length, 1, `round ${round}: one winner of box 5`);
      for (const result of results) if (result.error) assert.match(result.error, /Already taken: box 5/);
      assert.equal(await db.prisma.raffleBox.count({ where: { raffleId: raffle.id, number: 5 } }), 1);
      // The losers left no buyer without boxes and no payment behind.
      const entries = await db.prisma.raffleEntry.findMany({ where: { raffleId: raffle.id }, include: { boxes: true, payments: true } });
      for (const entry of entries) {
        assert.ok(entry.boxes.length > 0, `round ${round}: ${entry.name} has no boxes`);
        for (const payment of entry.payments) assert.equal(payment.amountCents, entry.boxes.length * 1000);
      }
    }
  });
});

describe("deleting a raffle", () => {
  it("a sale waiting behind the delete is told the raffle is gone", async (t) => {
    const raffle = await kit.makeRaffle();
    const deleting = await kit.holdRaffle(raffle.id);
    t.after(() => deleting.rollback());
    await deleting.query(`DELETE FROM "Raffle" WHERE id = $1`, [raffle.id]);
    const selling = kit.act(helper, () => raffles.assignBoxesAction(sale(raffle, "Ann", "1")));
    await kit.waitForWaiters(1);
    await deleting.commit();
    assert.match((await kit.resultOf(selling)).error ?? "", /no longer exists/);
    assert.equal(await db.prisma.raffleEntry.count({ where: { raffleId: raffle.id } }), 0);
  });
});
