/*
 * Deleting a trip payment, a trip registration (with its payments), or a
 * trip expense keeps a copy of the money in Payment Records, written by the
 * app with full context in the same transaction as the delete. Real Postgres.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { withTestDatabase } from "../support/db";
import { form, resetTestState, runAs, settle, type SessionUser } from "../support/context";
import { createUser, freshTrip, loadTripActions, type TripActions } from "./tripHelpers";

const db = withTestDatabase("payment_records_trips");
let actions: TripActions;
let records: typeof import("@/lib/paymentRecords");
let tripData: typeof import("@/lib/tripPageData");
let admin: SessionUser;

before(async () => {
  await db.ready;
  actions = await loadTripActions();
  records = await import("@/lib/paymentRecords");
  tripData = await import("@/lib/tripPageData");
  admin = await createUser(db.prisma, "ADMIN");
});

beforeEach(() => resetTestState());

let familyCounter = 0;

async function registrationWithPayments(tripPageId: string, amounts: number[]) {
  familyCounter += 1;
  const familyName = `Payers ${familyCounter}`;
  const registration = await db.prisma.tripRegistration.create({
    data: {
      tripPageId,
      familyName,
      contactEmail: `payers${familyCounter}@example.test`,
      guestOfName: "Ava Smith",
      affiliation: "PACK",
      payingCount: 2,
      amountOwedCents: 5000,
    },
  });
  const payments = [];
  for (const amountCents of amounts) {
    payments.push(
      await db.prisma.tripPayment.create({
        data: {
          tripRegistrationId: registration.id,
          amountCents,
          paidOn: new Date("2026-10-01T00:00:00Z"),
          note: "Zelle",
          recordedByUserId: admin.id,
        },
      }),
    );
  }
  return { registration, payments, familyName };
}

const keptCopiesOf = (originalIds: string[]) =>
  db.prisma.paymentRecord.findMany({ where: { originalId: { in: originalIds } }, orderBy: { amountCents: "asc" } });

describe("deleting a single trip payment", () => {
  it("removes the payment and keeps a full copy in Payment Records", async () => {
    const trip = await freshTrip(db.prisma, { slug: "camp-conron" });
    const { payments, familyName } = await registrationWithPayments(trip.id, [2500]);
    const [payment] = payments;

    await runAs(admin, () => actions.registration.deleteTripPaymentAction(form({ paymentId: payment.id })));

    assert.equal(await db.prisma.tripPayment.count({ where: { id: payment.id } }), 0);
    const [kept] = await keptCopiesOf([payment.id]);
    assert.ok(kept, "a copy was kept");
    assert.equal(kept.kind, "TRIP");
    assert.equal(kept.capturedBy, "app");
    assert.equal(kept.amountCents, 2500);
    assert.equal(kept.paidBy, familyName);
    assert.equal(kept.paidFor, `${trip.title} — ${familyName}`);
    assert.equal(kept.note, "Zelle");
    assert.equal(kept.deletionReason, "Trip payment deleted");
    assert.equal(kept.deletedByUserId, admin.id);
    assert.equal(kept.status, "NEEDS_DECISION");

    const audit = await db.prisma.auditLog.findFirst({ where: { action: "tripPayment.delete", entityId: payment.id } });
    assert.match(audit?.summary ?? "", /\$25\.00 trip payment from .* — kept in Payment Records/);
  });

  it("keeps exactly one copy when the same Delete is sent twice", async () => {
    const trip = await freshTrip(db.prisma, { slug: "camp-conron" });
    const { payments } = await registrationWithPayments(trip.id, [1000]);
    const remove = () =>
      settle(runAs(admin, () => actions.registration.deleteTripPaymentAction(form({ paymentId: payments[0].id }))));

    const first = await remove();
    const second = await remove();
    assert.equal(first.ok, true);
    assert.equal(second.ok, true, "the second delete finds nothing to delete and stops quietly");
    assert.equal((await keptCopiesOf([payments[0].id])).length, 1);
    assert.equal(
      await db.prisma.auditLog.count({ where: { action: "tripPayment.delete", entityId: payments[0].id } }),
      1,
      "only the delete that happened is in the audit log",
    );
  });

  it("keeps exactly one copy when two Deletes arrive at the same moment", async () => {
    const trip = await freshTrip(db.prisma, { slug: "camp-conron" });
    const { payments } = await registrationWithPayments(trip.id, [1500]);
    const remove = () =>
      settle(runAs(admin, () => actions.registration.deleteTripPaymentAction(form({ paymentId: payments[0].id }))));

    const results = await Promise.all([remove(), remove()]);
    assert.deepEqual(
      results.map((r) => r.ok),
      [true, true],
    );
    assert.equal(await db.prisma.tripPayment.count({ where: { id: payments[0].id } }), 0);
    assert.equal((await keptCopiesOf([payments[0].id])).length, 1);
    assert.equal(
      await db.prisma.auditLog.count({ where: { action: "tripPayment.delete", entityId: payments[0].id } }),
      1,
    );
  });

  it("keeps nothing and deletes nothing for someone who isn't an Admin", async () => {
    const trip = await freshTrip(db.prisma, { slug: "camp-conron" });
    const { payments } = await registrationWithPayments(trip.id, [1000]);
    const viewer = await createUser(db.prisma, "TRIP_VIEWER");

    const result = await settle(
      runAs(viewer, () => actions.registration.deleteTripPaymentAction(form({ paymentId: payments[0].id }))),
    );
    assert.equal(result.ok, false);
    assert.equal(await db.prisma.tripPayment.count({ where: { id: payments[0].id } }), 1);
    assert.equal((await keptCopiesOf([payments[0].id])).length, 0);
  });
});

describe("deleting a trip registration", () => {
  it("keeps every payment it had, and the audit entry says so", async () => {
    const trip = await freshTrip(db.prisma, { slug: "cyclones" });
    const { registration, payments, familyName } = await registrationWithPayments(trip.id, [1500, 2000]);

    await runAs(admin, () => actions.registration.deleteTripRegistrationAction(form({ id: registration.id })));

    assert.equal(await db.prisma.tripRegistration.count({ where: { id: registration.id } }), 0);
    assert.equal(await db.prisma.tripPayment.count({ where: { tripRegistrationId: registration.id } }), 0);
    const kept = await keptCopiesOf(payments.map((p) => p.id));
    assert.deepEqual(
      kept.map((k) => [k.amountCents, k.capturedBy, k.deletionReason]),
      [
        [1500, "app", `Trip registration "${familyName}" deleted`],
        [2000, "app", `Trip registration "${familyName}" deleted`],
      ],
    );
    const details = kept[0].details as Record<string, unknown>;
    assert.equal(details.tripRegistrationId, registration.id);
    assert.equal(details.contactEmail, registration.contactEmail);
    assert.equal(details.amountOwedCents, 5000);

    const audit = await db.prisma.auditLog.findFirst({
      where: { action: "tripRegistration.delete", entityId: registration.id },
    });
    assert.equal(audit?.summary, `Deleted the trip registration for ${familyName} — 2 payments ($35.00) kept in Payment Records`);
  });

  it("writes no record, and no mention of one, when it had no payments", async () => {
    const trip = await freshTrip(db.prisma, { slug: "cyclones" });
    const { registration, familyName } = await registrationWithPayments(trip.id, []);
    const before = await db.prisma.paymentRecord.count();

    await runAs(admin, () => actions.registration.deleteTripRegistrationAction(form({ id: registration.id })));

    assert.equal(await db.prisma.paymentRecord.count(), before);
    const audit = await db.prisma.auditLog.findFirst({
      where: { action: "tripRegistration.delete", entityId: registration.id },
    });
    assert.equal(audit?.summary, `Deleted the trip registration for ${familyName}`);
  });

  it("warns with the same count and total the page computes from its loaded payments", async () => {
    const trip = await freshTrip(db.prisma, { slug: "cyclones" });
    const { registration } = await registrationWithPayments(trip.id, [1500, 2000, 250]);
    const [loaded] = (await tripData.getTripRegistrations(trip.id)).filter((r) => r.id === registration.id);

    // TripAdminView builds the Remove Registration prompt from what it already loaded.
    const fromPage = { count: loaded.payments.length, totalCents: loaded.paidCents };
    assert.deepEqual(fromPage, await records.summarizePayments({ tripRegistrationId: registration.id }, db.prisma));
    assert.match(records.paymentDeletionWarning(fromPage), /3 payments totaling \$37\.50 attached/);
    assert.equal(records.paymentDeletionWarning({ count: 0, totalCents: 0 }), "");
  });
});

describe("deleting a trip expense", () => {
  it("keeps the expense or vendor credit, marked as not family money", async () => {
    const trip = await freshTrip(db.prisma, { slug: "camp-conron" });
    const expense = await db.prisma.tripExpense.create({
      data: { tripPageId: trip.id, description: "Firewood", amountCents: 4200, spentOn: new Date("2026-10-02T00:00:00Z"), paidBy: "Matt" },
    });
    const credit = await db.prisma.tripExpense.create({
      data: {
        tripPageId: trip.id,
        description: "Campsite deposit back",
        amountCents: 1000,
        isCredit: true,
        spentOn: new Date("2026-10-20T00:00:00Z"),
      },
    });

    await runAs(admin, () => actions.page.deleteTripExpenseAction(form({ id: expense.id })));
    await runAs(admin, () => actions.page.deleteTripExpenseAction(form({ id: credit.id })));

    assert.equal(await db.prisma.tripExpense.count({ where: { tripPageId: trip.id } }), 0);
    const kept = await keptCopiesOf([expense.id, credit.id]);
    assert.deepEqual(
      kept.map((k) => [k.kind, k.amountCents, k.isCredit, k.status, k.capturedBy, k.deletionReason, k.paidBy]),
      [
        ["TRIP_EXPENSE", 1000, true, "NOT_APPLICABLE", "app", "Trip expense deleted", null],
        ["TRIP_EXPENSE", 4200, false, "NOT_APPLICABLE", "app", "Trip expense deleted", "Matt"],
      ],
    );
    assert.equal(kept[1].paidFor, `${trip.title} — expense: Firewood`);
    assert.equal(kept[0].paidFor, `${trip.title} — vendor refund/credit: Campsite deposit back`);

    const audit = await db.prisma.auditLog.findFirst({ where: { action: "trip.expense.delete", entityId: expense.id } });
    assert.match(audit?.summary ?? "", /“Firewood” — kept in Payment Records$/);
  });
});
