/*
 * Deleting a raffle keeps its payments: every one (voided too) is copied into
 * PaymentRecord with the app's full context before the raffle and its
 * payments are deleted, in the same transaction. Removing a buyer never
 * deletes a payment at all — it's refused while they have live money, and
 * their voided payments survive the delete with the buyer's name on them.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { withTestDatabase } from "../support/db";
import { form, runAs, settle } from "../support/context";
import { raffleTestKit, type RaffleActions, type TestUser } from "./raffle-support";

const db = withTestDatabase("payment_records_raffles");
const kit = raffleTestKit(db);
let raffles: RaffleActions;
let master: TestUser;
let admin: TestUser;
let helper: TestUser;

before(async () => {
  await db.ready;
  raffles = await import("@/lib/actions/raffles");
  master = await kit.makeUser("ADMIN", { username: "mattrosen" });
  admin = await kit.makeUser("ADMIN");
  helper = await kit.makeUser("COMMITTEE", { raffleHelper: true });
});

/** A redirect thrown by a successful delete (the next/navigation stand-in). */
function redirectTarget(error: unknown) {
  return (error as { redirect?: string }).redirect ?? null;
}

describe("deleting a raffle", () => {
  it("keeps every payment, voided ones included, with who paid and why it was deleted", async () => {
    const raffle = await kit.makeRaffle({ name: "Oct 2026 Test" });
    const ann = await kit.sell(admin, raffles, raffle.id, "Ann Lee", "1,2", "CASH");
    const bob = await kit.sell(admin, raffles, raffle.id, "Bob Ray", "3", "ZELLE");
    const annPayment = await db.prisma.rafflePayment.findFirstOrThrow({ where: { entryId: ann.id } });
    const bobPayment = await db.prisma.rafflePayment.findFirstOrThrow({ where: { entryId: bob.id } });
    assert.deepEqual(
      await runAs(admin, () => raffles.voidPaymentAction(form({ paymentId: bobPayment.id, reason: "bounced" }))),
      {},
    );
    // Money nobody has been matched to yet, with only a payer name.
    const unmatched = await db.prisma.rafflePayment.create({
      data: { raffleId: raffle.id, amountCents: 500, method: "CASH", payerName: "Walk-up" },
    });

    const deleted = await settle(runAs(master, () => raffles.deleteRaffleAction(form({ raffleId: raffle.id }))));
    assert.ok(!deleted.ok && redirectTarget(deleted.error) === "/portal/admin/raffles", "deleting redirects to the list");

    assert.equal(await db.prisma.raffle.count({ where: { id: raffle.id } }), 0);
    assert.equal(await db.prisma.rafflePayment.count({ where: { raffleId: raffle.id } }), 0);

    const records = await db.prisma.paymentRecord.findMany({ where: { kind: "RAFFLE" }, orderBy: { amountCents: "asc" } });
    const byId = new Map(records.map((record) => [record.originalId, record]));
    assert.equal(byId.size, 3);

    const annRecord = byId.get(annPayment.id)!;
    assert.equal(annRecord.amountCents, 2000);
    assert.equal(annRecord.paidBy, "Ann Lee");
    assert.equal(annRecord.paidFor, "Raffle: Oct 2026 Test — Ann Lee");
    assert.equal(annRecord.method, "CASH");
    assert.equal(annRecord.capturedBy, "app");
    assert.equal(annRecord.status, "NEEDS_DECISION");
    assert.equal(annRecord.deletionReason, 'Raffle "Oct 2026 Test" deleted');
    assert.equal(annRecord.deletedByUserId, master.id);
    assert.equal(annRecord.deletedByName, master.displayName);

    const bobRecord = byId.get(bobPayment.id)!;
    assert.equal(bobRecord.wasVoided, true);
    assert.equal(bobRecord.voidReason, "bounced");
    assert.equal(bobRecord.status, "NOT_APPLICABLE");
    assert.equal(bobRecord.paidBy, "Bob Ray");

    const walkUp = byId.get(unmatched.id)!;
    assert.equal(walkUp.paidBy, "Walk-up");
    assert.equal(walkUp.paidFor, "Raffle: Oct 2026 Test");

    // The audit entry says what was kept: 3 payments, $25.00 of live money (the voided $10 not counted).
    const audit = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "raffle.delete", entityId: raffle.id } });
    assert.match(audit.summary, /with its 2 buyers, 3 boxes and 3 payments — 3 payments \(\$25\.00\) kept in Payment Records$/);
  });

  it("a raffle with no payments deletes cleanly and keeps nothing", async () => {
    const raffle = await kit.makeRaffle();
    await kit.sell(admin, raffles, raffle.id, "Cy", "7");
    const before = await db.prisma.paymentRecord.count();
    const deleted = await settle(runAs(master, () => raffles.deleteRaffleAction(form({ raffleId: raffle.id }))));
    assert.ok(!deleted.ok && redirectTarget(deleted.error));
    assert.equal(await db.prisma.paymentRecord.count(), before);
    const audit = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "raffle.delete", entityId: raffle.id } });
    assert.doesNotMatch(audit.summary, /Payment Records/);
  });

  it("only a master admin can delete, and a refused delete keeps the payments where they were", async () => {
    const raffle = await kit.makeRaffle();
    await kit.sell(admin, raffles, raffle.id, "Dee", "4", "CASH");
    const before = await db.prisma.paymentRecord.count();
    const refused = await settle(runAs(admin, () => raffles.deleteRaffleAction(form({ raffleId: raffle.id }))));
    assert.ok(!refused.ok && /master admin only/.test(refused.error.message));
    assert.equal(await db.prisma.rafflePayment.count({ where: { raffleId: raffle.id } }), 1);
    assert.equal(await db.prisma.paymentRecord.count(), before);
  });

  it("if the delete fails, no payment record is left behind (the copy and delete are one transaction)", async () => {
    const raffle = await kit.makeRaffle({ name: "Rollback Test" });
    await kit.sell(admin, raffles, raffle.id, "Eve", "5", "CASH");
    // Make the raffle delete itself fail after the copy has been written.
    await db.pool.query(`
      CREATE FUNCTION test_block_raffle_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'blocked for test'; END $$;
      CREATE TRIGGER test_block_raffle_delete BEFORE DELETE ON "Raffle"
        FOR EACH ROW WHEN (OLD.name = 'Rollback Test') EXECUTE FUNCTION test_block_raffle_delete();
    `);
    try {
      const failed = await settle(runAs(master, () => raffles.deleteRaffleAction(form({ raffleId: raffle.id }))));
      if (failed.ok) assert.ok(failed.value.error, "the action reports the failure");
      else assert.equal(redirectTarget(failed.error), null, "no redirect when the delete fails");
    } finally {
      await db.pool.query(`DROP TRIGGER test_block_raffle_delete ON "Raffle"; DROP FUNCTION test_block_raffle_delete();`);
    }
    assert.equal(await db.prisma.raffle.count({ where: { id: raffle.id } }), 1);
    assert.equal(await db.prisma.rafflePayment.count({ where: { raffleId: raffle.id } }), 1);
    assert.equal(await db.prisma.paymentRecord.count({ where: { deletionReason: 'Raffle "Rollback Test" deleted' } }), 0);
  });
});

describe("removing a buyer", () => {
  it("is refused while they have live payments, so no money is cut loose", async () => {
    const raffle = await kit.makeRaffle();
    const fay = await kit.sell(helper, raffles, raffle.id, "Fay", "8", "CASH");
    const result = await runAs(helper, () => raffles.removeEntryAction(form({ entryId: fay.id })));
    assert.match(result.error ?? "", /Fay has \$10\.00 in payments recorded/);
    assert.equal(await db.prisma.raffleEntry.count({ where: { id: fay.id } }), 1);
  });

  it("keeps voided payments in place with the buyer's name stamped on them", async () => {
    const raffle = await kit.makeRaffle();
    const gus = await kit.sell(admin, raffles, raffle.id, "Gus Hill", "9", "CASH");
    const payment = await db.prisma.rafflePayment.findFirstOrThrow({ where: { entryId: gus.id } });
    assert.equal(payment.payerName, null);
    assert.deepEqual(await runAs(admin, () => raffles.voidPaymentAction(form({ paymentId: payment.id, reason: "wrong buyer" }))), {});
    const before = await db.prisma.paymentRecord.count();

    assert.deepEqual(await runAs(admin, () => raffles.removeEntryAction(form({ entryId: gus.id }))), {});

    const after = await db.prisma.rafflePayment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.equal(after.entryId, null);
    assert.equal(after.payerName, "Gus Hill");
    assert.notEqual(after.voidedAt, null);
    // Nothing was deleted, so nothing needed copying.
    assert.equal(await db.prisma.paymentRecord.count(), before);
  });
});
