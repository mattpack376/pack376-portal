/*
 * How long a raffle change waits behind a stuck one (follow-up review of the
 * F2/F3 fix, 2026-10-27). Prisma's interactive-transaction `timeout` can't
 * interrupt a query that is waiting for a lock: before this, a change queued
 * behind a raffle-lock holder that never finished — a frozen or killed server
 * function mid-transaction, a hand-run psql session — sat there for as long
 * as the lock was held. Each raffle transaction now sets Postgres's own
 * lock_timeout (10s) and idle_in_transaction_session_timeout (30s) for itself.
 *
 * These tests wait out the real 10-second limit, so they live in their own
 * file and run alongside the others.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import pg from "pg";
import { withTestDatabase } from "../support/db";
import { form, runAs } from "../support/context";
import { raffleTestKit, type RaffleActions, type TestUser } from "./raffle-support";

const db = withTestDatabase("raffle_lock_timeout");
const kit = raffleTestKit(db);
let raffles: RaffleActions;
let appPrisma: typeof import("@/lib/prisma").prisma;
let admin: TestUser;
let helper: TestUser;

before(async () => {
  await db.ready;
  raffles = await import("@/lib/actions/raffles");
  appPrisma = (await import("@/lib/prisma")).prisma;
  admin = await kit.makeUser("ADMIN");
  helper = await kit.makeUser("DEN", { raffleHelper: true });
});

const BUSY = /Someone else is saving a change to this raffle right now/;
const sale = (raffleId: string, name: string, boxes: string, paid = "", priceCents = 1000) =>
  form({ raffleId, name, boxes, paid, priceCents });

/** Times a settled action. */
async function timed<T>(pending: Promise<T>) {
  const started = Date.now();
  const value = await pending;
  return { value, ms: Date.now() - started };
}

describe("a change stuck behind another gives up", () => {
  it("waiting past 10s on the raffle lock, or on a login row, returns the busy message and saves nothing", async (t) => {
    // 1. Something holds the raffle row and never finishes.
    const stuckRaffle = await kit.makeRaffle();
    const raffleHolder = await kit.holdRaffle(stuckRaffle.id);
    t.after(() => raffleHolder.rollback());

    // 2. A sale that gets the raffle lock, writes its box and payment, then
    //    waits on the seller's own login row (a foreign key check) — held by,
    //    say, a password reset that never finishes. The whole sale must roll
    //    back, not leave its box behind.
    const otherRaffle = await kit.makeRaffle();
    const userHolder = await kit.pauseUser(helper);
    t.after(() => userHolder.rollback());

    const waitingOnRaffle = timed(kit.resultOf(kit.act(admin, () => raffles.assignBoxesAction(sale(stuckRaffle.id, "Ann", "1", "CASH")))));
    const waitingOnUser = timed(kit.resultOf(kit.act(helper, () => raffles.assignBoxesAction(sale(otherRaffle.id, "Bob", "2", "ZELLE")))));
    await kit.waitForWaiters(2);

    // Before the fix both of these waited until the holders let go (the test
    // would hit its own timeout); now each gives up on its own after ~10s
    // while the holders are still there.
    const [onRaffle, onUser] = await Promise.all([waitingOnRaffle, waitingOnUser]);
    for (const { value, ms } of [onRaffle, onUser]) {
      assert.match(value.error ?? "", BUSY);
      assert.ok(ms >= 9_000 && ms < 14_000, `gave up after ${ms}ms, expected about 10s`);
    }

    for (const raffleId of [stuckRaffle.id, otherRaffle.id]) {
      assert.deepEqual(await kit.boardOf(raffleId), [], "no box left behind");
      assert.equal(await db.prisma.raffleEntry.count({ where: { raffleId } }), 0, "no buyer left behind");
      assert.equal(await db.prisma.rafflePayment.count({ where: { raffleId } }), 0, "no payment left behind");
    }
    assert.equal(await kit.auditCount("raffle.box.assign"), 0);

    // Once the holders are gone, the same sales go straight through.
    await raffleHolder.rollback();
    await userHolder.rollback();
    const retried = await timed(runAs(admin, () => raffles.assignBoxesAction(sale(stuckRaffle.id, "Ann", "1", "CASH"))));
    assert.deepEqual(retried.value, {});
    assert.ok(retried.ms < 2_000, `the retry took ${retried.ms}ms`);
    await kit.sell(helper, raffles, otherRaffle.id, "Bob", "2", "ZELLE");
  });

  it("a raffle-lock holder left idle mid-transaction is cut off, and the waiting change goes through", async (t) => {
    // What raffleTransaction sets, with a 1-second idle limit instead of 30 so
    // the test doesn't wait half a minute: a holder that stops sending
    // statements (its server function frozen or killed) is ended by Postgres,
    // which releases the raffle lock.
    const raffle = await kit.makeRaffle();
    const holder = new pg.Client({ connectionString: db.url });
    holder.on("error", () => {}); // Postgres ends this session on purpose
    await holder.connect();
    t.after(() => holder.end().catch(() => {}));
    await holder.query("BEGIN");
    await holder.query(`SELECT set_config('lock_timeout', '10s', true), set_config('idle_in_transaction_session_timeout', '1s', true)`);
    await holder.query(`SELECT id FROM "Raffle" WHERE id = $1 FOR UPDATE`, [raffle.id]);

    const selling = timed(kit.resultOf(kit.act(helper, () => raffles.assignBoxesAction(sale(raffle.id, "Ann", "1")))));
    await kit.waitForWaiters(1);
    const { value, ms } = await selling;
    assert.deepEqual(value, {});
    assert.ok(ms < 5_000, `went through after ${ms}ms`);
    await assert.rejects(holder.query("SELECT 1"), "the idle holder's session was ended");
    assert.deepEqual(await kit.boardOf(raffle.id), ["1:Ann"]);
  });
});

describe("the limits belong to raffle transactions only", () => {
  it("are in force inside a raffle change and gone after it", async (t) => {
    // Look inside the action's own transaction: wrap the app client's
    // $transaction so the callback reads the settings just before it returns.
    const seen: { lockTimeout: string; idleTimeout: string }[] = [];
    const client = appPrisma as unknown as { $transaction: (...args: unknown[]) => Promise<unknown> };
    const original = client.$transaction;
    client.$transaction = function (this: unknown, fn: unknown, options: unknown) {
      if (typeof fn !== "function") return original.call(this, fn, options);
      return original.call(
        this,
        async (tx: { $queryRaw: (strings: TemplateStringsArray) => Promise<{ lockTimeout: string; idleTimeout: string }[]> }) => {
          const result = await fn(tx);
          const [settings] = await tx.$queryRaw`SELECT current_setting('lock_timeout') AS "lockTimeout",
            current_setting('idle_in_transaction_session_timeout') AS "idleTimeout"`;
          seen.push(settings);
          return result;
        },
        options,
      );
    };
    t.after(() => {
      client.$transaction = original;
    });

    const raffle = await kit.makeRaffle();
    await kit.sell(helper, raffles, raffle.id, "Ann", "1", "CASH");
    const payment = await db.prisma.rafflePayment.findFirstOrThrow({ where: { raffleId: raffle.id } });
    assert.deepEqual(
      await runAs(admin, () => raffles.setPaymentVerifiedAction(form({ paymentId: payment.id, verified: "true", amountCents: 1000, method: "CASH" }))),
      {},
    );
    assert.deepEqual(await runAs(admin, () => raffles.closeRaffleAction(form({ raffleId: raffle.id }))), {});
    client.$transaction = original;

    assert.equal(seen.length, 3, "the sale, the verify and the close each ran one raffle transaction");
    for (const settings of seen) assert.deepEqual(settings, { lockTimeout: "10s", idleTimeout: "30s" });

    // SET LOCAL: the app's pooled connections are back to the server's defaults.
    for (let i = 0; i < 5; i++) {
      const [after] = await appPrisma.$queryRaw<{ lockTimeout: string; idleTimeout: string }[]>`
        SELECT current_setting('lock_timeout') AS "lockTimeout", current_setting('idle_in_transaction_session_timeout') AS "idleTimeout"`;
      assert.deepEqual(after, { lockTimeout: "0", idleTimeout: "0" });
    }
  });
});
