/*
 * Event deletes keep their payments: deleting an event, a scout's
 * registration, a guest group, or a single payment copies every payment it
 * removes into PaymentRecord (written by the app, with names and the reason),
 * in the same commit as the delete. A family withdrawing its own guest group
 * once money is recorded is still refused. The Delete prompts' payment
 * warning counts the same way summarizePayments does.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, describe, it } from "node:test";
import { withTestDatabase } from "../support/db";
import { form, resetTestState, runAs, settle, type SessionUser } from "../support/context";
import { packFixtures } from "./fixtures/pack";

const db = withTestDatabase("payment_records_events");
let events: typeof import("@/lib/actions/events");
let records: typeof import("@/lib/paymentRecords");
let fx: ReturnType<typeof packFixtures>;
let admin: SessionUser;

before(async () => {
  await db.ready;
  events = await import("@/lib/actions/events");
  records = await import("@/lib/paymentRecords");
  fx = packFixtures(db.prisma);
  admin = await fx.user("ADMIN", { displayName: "Akela Admin" });
});

beforeEach(() => resetTestState());

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** An event with one scout (two payments) and one guest group (one payment). */
async function eventWithMoney(title = `Pinewood ${randomUUID().slice(0, 6)}`) {
  const event = await fx.event({ title });
  const den = await fx.den("BEAR");
  const scout = await fx.scout(den.id, { firstName: "Ava" });
  const registration = await db.prisma.eventRegistration.create({
    data: { eventId: event.id, scoutId: scout.id, amountOwedCents: 3000 },
  });
  const [p1, p2] = await Promise.all([
    db.prisma.eventPayment.create({
      data: { eventRegistrationId: registration.id, amountCents: 1500, paidOn: day("2026-10-01"), note: "cash" },
    }),
    db.prisma.eventPayment.create({
      data: { eventRegistrationId: registration.id, amountCents: 1000, paidOn: day("2026-10-02"), recordedByUserId: admin.id },
    }),
  ]);
  const group = await db.prisma.eventGuestGroup.create({
    data: { eventId: event.id, familyName: "Grandparents", adultCount: 2, childCount: 0, amountOwedCents: 2000 },
  });
  const g1 = await db.prisma.eventGuestGroupPayment.create({
    data: { eventGuestGroupId: group.id, amountCents: 2000, paidOn: day("2026-10-03") },
  });
  return { event, scout, registration, group, eventPayments: [p1, p2], guestPayment: g1 };
}

async function keptFor(originalIds: string[]) {
  return db.prisma.paymentRecord.findMany({ where: { originalId: { in: originalIds } }, orderBy: { amountCents: "asc" } });
}

describe("deleteEventAction", () => {
  it("keeps every scout and guest payment, with names and the reason, then deletes the event", async () => {
    const { event, scout, eventPayments, guestPayment } = await eventWithMoney("Pinewood Derby Keep");

    const outcome = await settle(runAs(admin, () => events.deleteEventAction(form({ id: event.id }))));
    assert.equal(outcome.ok ? "" : (outcome.error as { redirect?: string }).redirect, "/portal/admin/events");
    assert.equal(await db.prisma.event.count({ where: { id: event.id } }), 0);
    assert.equal(await db.prisma.eventPayment.count({ where: { id: { in: eventPayments.map((p) => p.id) } } }), 0);

    const kept = await keptFor([...eventPayments.map((p) => p.id), guestPayment.id]);
    assert.equal(kept.length, 3);
    for (const row of kept) {
      assert.equal(row.capturedBy, "app", "written by the app, not only the safety-net trigger");
      assert.equal(row.deletionReason, 'Event "Pinewood Derby Keep" deleted');
      assert.equal(row.deletedByUserId, admin.id);
      assert.equal(row.deletedByName, "Akela Admin");
      assert.equal(row.status, "NEEDS_DECISION");
    }
    const scoutRows = kept.filter((r) => r.kind === "EVENT");
    assert.equal(scoutRows.length, 2);
    assert.ok(scoutRows.every((r) => r.paidBy === `Ava ${scout.lastName}`));
    assert.ok(scoutRows.every((r) => r.paidFor.startsWith("Pinewood Derby Keep")));
    assert.equal(kept.find((r) => r.amountCents === 1500)?.note, "cash");
    const guestRow = kept.find((r) => r.kind === "GUEST_GROUP");
    assert.equal(guestRow?.paidBy, "Grandparents");
    assert.equal(guestRow?.amountCents, 2000);

    const audit = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "event.delete", entityId: event.id } });
    assert.match(audit.summary, /3 payments \(\$45\.00\) kept in Payment Records/);
  });

  it("keeps nothing and says nothing about payments for an event without any", async () => {
    const event = await fx.event({ title: "Nothing paid" });
    await settle(runAs(admin, () => events.deleteEventAction(form({ id: event.id }))));
    const audit = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "event.delete", entityId: event.id } });
    assert.doesNotMatch(audit.summary, /Payment Records/);
  });

  it("refuses a non-Admin before keeping or deleting anything", async () => {
    const { event, eventPayments } = await eventWithMoney();
    const parent = await fx.user("PARENT");
    const outcome = await settle(runAs(parent, () => events.deleteEventAction(form({ id: event.id }))));
    assert.equal(outcome.ok, false);
    assert.equal(await db.prisma.event.count({ where: { id: event.id } }), 1);
    assert.equal((await keptFor(eventPayments.map((p) => p.id))).length, 0);
  });
});

describe("removeRegistrationAction", () => {
  it("keeps the scout's payments, then removes the registration, with the count in the audit entry", async () => {
    const { event, scout, registration, eventPayments, guestPayment } = await eventWithMoney("Fall Hike");

    await runAs(admin, () =>
      events.removeRegistrationAction(form({ registrationId: registration.id, eventId: event.id })),
    );
    assert.equal(await db.prisma.eventRegistration.count({ where: { id: registration.id } }), 0);
    const kept = await keptFor(eventPayments.map((p) => p.id));
    assert.equal(kept.length, 2);
    assert.ok(kept.every((r) => r.capturedBy === "app"));
    assert.ok(kept.every((r) => r.deletionReason === `Ava ${scout.lastName} removed from "Fall Hike"`));
    // The guest group on the same event is untouched.
    assert.equal((await keptFor([guestPayment.id])).length, 0);
    assert.equal(await db.prisma.eventGuestGroupPayment.count({ where: { id: guestPayment.id } }), 1);

    const audit = await db.prisma.auditLog.findFirstOrThrow({
      where: { action: "eventRegistration.delete", entityId: registration.id },
    });
    assert.match(audit.summary, /2 payments \(\$25\.00\) kept in Payment Records/);

    // A second click finds it gone: no error, no second audit entry.
    await runAs(admin, () =>
      events.removeRegistrationAction(form({ registrationId: registration.id, eventId: event.id })),
    );
    assert.equal(
      await db.prisma.auditLog.count({ where: { action: "eventRegistration.delete", entityId: registration.id } }),
      1,
    );
  });
});

describe("removeGuestGroupAction (Admin)", () => {
  it("keeps the group's payments, then removes the group", async () => {
    const { event, group, guestPayment } = await eventWithMoney("Spring Picnic");
    await runAs(admin, () => events.removeGuestGroupAction(form({ guestGroupId: group.id, eventId: event.id })));
    assert.equal(await db.prisma.eventGuestGroup.count({ where: { id: group.id } }), 0);
    const [row] = await keptFor([guestPayment.id]);
    assert.equal(row.kind, "GUEST_GROUP");
    assert.equal(row.capturedBy, "app");
    assert.equal(row.deletionReason, 'Guest group "Grandparents" removed from "Spring Picnic"');
    const audit = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "guestGroup.delete", entityId: group.id } });
    assert.match(audit.summary, /1 payment \(\$20\.00\) kept in Payment Records/);
  });
});

describe("removeMyGuestGroupAction (family)", () => {
  it("still refuses a family withdrawing a group with money recorded, and keeps nothing", async () => {
    const parent = await fx.user("PARENT");
    const event = await fx.event();
    const group = await db.prisma.eventGuestGroup.create({
      data: { eventId: event.id, familyName: "Paid Family", adultCount: 1, childCount: 0, amountOwedCents: 1000, addedByUserId: parent.id },
    });
    const payment = await db.prisma.eventGuestGroupPayment.create({
      data: { eventGuestGroupId: group.id, amountCents: 1000, paidOn: day("2026-10-05") },
    });
    const outcome = await settle(runAs(parent, () => events.removeMyGuestGroupAction(form({ guestGroupId: group.id }))));
    assert.equal(outcome.ok, false);
    assert.match(outcome.ok ? "" : outcome.error.message, /Contact the pack/);
    assert.equal(await db.prisma.eventGuestGroup.count({ where: { id: group.id } }), 1);
    assert.equal((await keptFor([payment.id])).length, 0);
  });
});

describe("single payment deletes", () => {
  it("deleteEventPaymentAction keeps that one payment only", async () => {
    const { event, registration, eventPayments } = await eventWithMoney();
    const [target, other] = eventPayments;
    await runAs(admin, () =>
      events.deleteEventPaymentAction(form({ paymentId: target.id, registrationId: registration.id, eventId: event.id })),
    );
    assert.equal(await db.prisma.eventPayment.count({ where: { id: target.id } }), 0);
    const [row] = await keptFor([target.id]);
    assert.equal(row.deletionReason, "Payment deleted");
    assert.equal(row.capturedBy, "app");
    assert.equal(row.amountCents, target.amountCents);
    assert.equal((await keptFor([other.id])).length, 0);
    const audit = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "eventPayment.delete", entityId: target.id } });
    assert.match(audit.summary, /kept in Payment Records/);
  });

  it("deleteGuestGroupPaymentAction keeps the payment, with the group's name", async () => {
    const { event, group, guestPayment } = await eventWithMoney();
    await runAs(admin, () =>
      events.deleteGuestGroupPaymentAction(form({ paymentId: guestPayment.id, guestGroupId: group.id, eventId: event.id })),
    );
    assert.equal(await db.prisma.eventGuestGroupPayment.count({ where: { id: guestPayment.id } }), 0);
    const [row] = await keptFor([guestPayment.id]);
    assert.equal(row.paidBy, "Grandparents");
    assert.equal(row.deletionReason, "Payment deleted");
    assert.equal(row.capturedBy, "app");
  });
});

describe("the Delete prompts' payment warning", () => {
  it("counts what the event page counts from loaded data, the same as summarizePayments", async () => {
    const { event, registration, group } = await eventWithMoney();
    const { getEventDetail } = await import("@/lib/eventsData");
    const detail = await getEventDetail(event.id);
    assert.ok(detail);
    // The same reduction the event page does for its Delete Event button.
    const loaded = [...detail.registrations, ...detail.guestGroups].reduce(
      (sum, row) => ({ count: sum.count + row.payments.length, totalCents: sum.totalCents + row.paidCents }),
      { count: 0, totalCents: 0 },
    );
    assert.deepEqual(loaded, await records.summarizePayments({ eventId: event.id }, db.prisma));
    assert.deepEqual(loaded, { count: 3, totalCents: 4500 });

    const reg = detail.registrations.find((r) => r.id === registration.id)!;
    assert.deepEqual(
      { count: reg.payments.length, totalCents: reg.paidCents },
      await records.summarizePayments({ eventRegistrationId: registration.id }, db.prisma),
    );
    const grp = detail.guestGroups.find((g) => g.id === group.id)!;
    assert.deepEqual(
      { count: grp.payments.length, totalCents: grp.paidCents },
      await records.summarizePayments({ eventGuestGroupId: group.id }, db.prisma),
    );

    assert.match(records.paymentDeletionWarning(loaded), /3 payments totaling \$45\.00 attached/);
    assert.equal(records.paymentDeletionWarning({ count: 0, totalCents: 0 }), "");
  });
});
