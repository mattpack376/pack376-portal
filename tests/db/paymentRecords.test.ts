/*
 * Payment Records against a real database: the BEFORE DELETE safety-net
 * triggers (migration 20261028120000_payment_records), keepPaymentRecords
 * writing the full-context copy in the delete's own transaction, the
 * delete-warning counts, and Admin → Payment Records itself (recording an
 * outcome, the CSV export, who may open it).
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { withTestDatabase } from "../support/db";
import { form, resetTestState, runAs, settle, testState, type SessionUser } from "../support/context";
import type { SessionPayload } from "@/lib/session";

const db = withTestDatabase("payment_records");
let records: typeof import("@/lib/paymentRecords");
let actions: typeof import("@/lib/actions/paymentRecords");
let exportRoute: typeof import("@/app/portal/(authed)/admin/payment-records/export/route");
let page: typeof import("@/app/portal/(authed)/admin/payment-records/page");
let proxyModule: typeof import("@/proxy");
let sessionModule: typeof import("@/lib/session");
let nextServer: typeof import("next/server");
let admin: SessionUser;
let juniorAdmin: SessionUser;
let committee: SessionUser;

before(async () => {
  await db.ready;
  records = await import("@/lib/paymentRecords");
  actions = await import("@/lib/actions/paymentRecords");
  exportRoute = await import("@/app/portal/(authed)/admin/payment-records/export/route");
  page = await import("@/app/portal/(authed)/admin/payment-records/page");
  proxyModule = await import("@/proxy");
  sessionModule = await import("@/lib/session");
  nextServer = await import("next/server");
  const make = async (username: string, role: SessionUser["role"], displayName: string) => {
    const user = await db.prisma.user.create({ data: { username, passwordHash: "x", role, displayName } });
    return { id: user.id, role, sessionVersion: 0, displayName } satisfies SessionUser;
  };
  admin = await make("pr-admin", "ADMIN", "Treasurer Pat");
  juniorAdmin = await make("pr-junior", "JUNIOR_ADMIN", "Junior Jo");
  committee = await make("pr-committee", "COMMITTEE", "Committee Cam");
});

beforeEach(() => resetTestState());

const DAY = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const asSession = (user: SessionUser): SessionPayload => ({
  userId: user.id,
  role: user.role,
  denIds: [],
  scoutIds: [],
  displayName: user.displayName ?? "Test user",
  sv: user.sessionVersion,
});

let counter = 0;

/** One of everything that carries money, each with a payment attached. */
async function seed() {
  counter += 1;
  const n = counter;
  const p = db.prisma;
  const den = await p.den.create({ data: { rank: "BEAR", scoutingYear: "2026-2027", label: `PR${n}` } });
  const scout = await p.scout.create({ data: { denId: den.id, firstName: "Ava", lastName: `Smith${n}` } });
  const dues = await p.duesPayment.create({
    data: { scoutId: scout.id, amountCents: 10000, paidOn: DAY("2026-09-12"), note: "Zelle", recordedByUserId: admin.id },
  });
  const event = await p.event.create({ data: { title: `Pinewood Derby ${n}`, eventDate: DAY("2026-11-07") } });
  const registration = await p.eventRegistration.create({ data: { eventId: event.id, scoutId: scout.id, amountOwedCents: 2500 } });
  const eventPayment = await p.eventPayment.create({
    data: { eventRegistrationId: registration.id, amountCents: 2500, paidOn: DAY("2026-10-01"), recordedByUserId: admin.id },
  });
  const group = await p.eventGuestGroup.create({
    data: { eventId: event.id, familyName: `Guest Family ${n}`, adultCount: 2, amountOwedCents: 3000 },
  });
  const groupPayment = await p.eventGuestGroupPayment.create({
    data: { eventGuestGroupId: group.id, amountCents: 3000, paidOn: DAY("2026-10-02") },
  });
  const trip = await p.tripPage.create({ data: { slug: `pr-trip-${n}`, title: `Camp Test ${n}`, regularPriceCents: 4000 } });
  const tripRegistration = await p.tripRegistration.create({
    data: {
      tripPageId: trip.id,
      familyName: `Trip Family ${n}`,
      contactEmail: `family${n}@example.test`,
      contactPhone: "(718) 555-0100",
      guestOfName: "Ava",
      affiliation: "PACK",
      payingCount: 1,
      amountOwedCents: 4000,
    },
  });
  const tripPayment = await p.tripPayment.create({
    data: { tripRegistrationId: tripRegistration.id, amountCents: 4000, paidOn: DAY("2026-10-03") },
  });
  const expense = await p.tripExpense.create({
    data: { tripPageId: trip.id, description: "Firewood", amountCents: 1500, spentOn: DAY("2026-10-04"), paidBy: "Pat" },
  });
  const raffle = await p.raffle.create({ data: { name: `Oct Raffle ${n}`, boxCount: 50, priceCents: 1000 } });
  const entry = await p.raffleEntry.create({ data: { raffleId: raffle.id, name: `Buyer ${n}` } });
  const rafflePayment = await p.rafflePayment.create({
    data: { raffleId: raffle.id, entryId: entry.id, method: "ZELLE", amountCents: 2000, receivedOn: DAY("2026-10-05") },
  });
  const voidedPayment = await p.rafflePayment.create({
    data: {
      raffleId: raffle.id,
      entryId: entry.id,
      method: "CASH",
      amountCents: 1000,
      voidedAt: new Date(),
      voidedByName: "Treasurer Pat",
      voidReason: "Duplicate",
    },
  });
  return { den, scout, dues, event, registration, eventPayment, group, groupPayment, trip, tripRegistration, tripPayment, expense, raffle, entry, rafflePayment, voidedPayment };
}

const recordOf = (kind: "DUES" | "EVENT" | "GUEST_GROUP" | "TRIP" | "RAFFLE" | "TRIP_EXPENSE", originalId: string) =>
  db.prisma.paymentRecord.findUnique({ where: { kind_originalId: { kind, originalId } } });

describe("safety-net triggers (a delete that never called keepPaymentRecords)", () => {
  it("copies each kind of payment deleted directly, as capturedBy 'database'", async () => {
    const s = await seed();
    await db.prisma.duesPayment.delete({ where: { id: s.dues.id } });
    await db.prisma.eventPayment.delete({ where: { id: s.eventPayment.id } });
    await db.prisma.eventGuestGroupPayment.delete({ where: { id: s.groupPayment.id } });
    await db.prisma.tripPayment.delete({ where: { id: s.tripPayment.id } });
    await db.prisma.rafflePayment.delete({ where: { id: s.rafflePayment.id } });
    await db.prisma.rafflePayment.delete({ where: { id: s.voidedPayment.id } });
    await db.prisma.tripExpense.delete({ where: { id: s.expense.id } });

    const dues = await recordOf("DUES", s.dues.id);
    assert.ok(dues);
    assert.equal(dues.capturedBy, "database");
    assert.equal(dues.amountCents, 10000);
    assert.equal(dues.paidFor, `Dues — Ava Smith${counter}`);
    assert.equal(dues.paidBy, `Ava Smith${counter}`);
    assert.equal(dues.note, "Zelle");
    assert.equal(dues.recordedByName, "Treasurer Pat");
    assert.equal(dues.status, "NEEDS_DECISION");
    assert.equal(dues.deletionReason, "Deleted (reason not recorded)");
    assert.equal(dues.deletedByUserId, null);

    const event = await recordOf("EVENT", s.eventPayment.id);
    assert.equal(event?.capturedBy, "database");
    assert.equal(event?.paidFor, `Pinewood Derby ${counter} (Nov 7, 2026)`);
    assert.equal(event?.status, "NEEDS_DECISION");

    const group = await recordOf("GUEST_GROUP", s.groupPayment.id);
    assert.equal(group?.capturedBy, "database");
    assert.equal(group?.paidBy, `Guest Family ${counter}`);
    assert.equal(group?.amountCents, 3000);

    const trip = await recordOf("TRIP", s.tripPayment.id);
    assert.equal(trip?.capturedBy, "database");
    assert.equal(trip?.paidFor, `Camp Test ${counter}`);
    assert.deepEqual(
      { email: (trip?.details as Record<string, unknown>).contactEmail, phone: (trip?.details as Record<string, unknown>).contactPhone },
      { email: `family${counter}@example.test`, phone: "(718) 555-0100" },
    );

    const raffle = await recordOf("RAFFLE", s.rafflePayment.id);
    assert.equal(raffle?.capturedBy, "database");
    assert.equal(raffle?.status, "NEEDS_DECISION");
    assert.equal(raffle?.method, "ZELLE");
    assert.equal(raffle?.paidBy, `Buyer ${counter}`);

    const voided = await recordOf("RAFFLE", s.voidedPayment.id);
    assert.equal(voided?.capturedBy, "database");
    assert.equal(voided?.status, "NOT_APPLICABLE");
    assert.equal(voided?.wasVoided, true);
    assert.equal(voided?.voidReason, "Duplicate");

    const expense = await recordOf("TRIP_EXPENSE", s.expense.id);
    assert.equal(expense?.capturedBy, "database");
    assert.equal(expense?.status, "NOT_APPLICABLE");
    assert.equal(expense?.paidFor, `Camp Test ${counter} — Firewood`);
  });

  it("catches payments a cascade removes (deleting the event, the scout, the raffle, the trip)", async () => {
    const s = await seed();
    await db.prisma.event.delete({ where: { id: s.event.id } });
    await db.prisma.scout.delete({ where: { id: s.scout.id } });
    await db.prisma.raffle.delete({ where: { id: s.raffle.id } });
    await db.prisma.tripPage.delete({ where: { id: s.trip.id } });
    for (const [kind, id, cents] of [
      ["EVENT", s.eventPayment.id, 2500],
      ["GUEST_GROUP", s.groupPayment.id, 3000],
      ["DUES", s.dues.id, 10000],
      ["RAFFLE", s.rafflePayment.id, 2000],
      ["RAFFLE", s.voidedPayment.id, 1000],
      ["TRIP", s.tripPayment.id, 4000],
      ["TRIP_EXPENSE", s.expense.id, 1500],
    ] as const) {
      const row = await recordOf(kind, id);
      assert.ok(row, `${kind} ${id} kept`);
      assert.equal(row.amountCents, cents);
      assert.equal(row.capturedBy, "database");
      assert.ok(row.paidFor.length > 0);
    }
  });
});

describe("keepPaymentRecords", () => {
  it("writes one full-context row per payment in the delete's transaction; the trigger doesn't duplicate it", async () => {
    const s = await seed();
    const kept = await db.prisma.$transaction(async (tx) => {
      const summary = await records.keepPaymentRecords(tx, { eventId: s.event.id }, {
        session: asSession(admin),
        reason: `Event "Pinewood Derby ${counter}" deleted`,
      });
      await tx.event.delete({ where: { id: s.event.id } });
      return summary;
    });
    assert.deepEqual(kept, { count: 2, totalCents: 5500 });

    const event = await recordOf("EVENT", s.eventPayment.id);
    assert.ok(event);
    assert.equal(event.capturedBy, "app");
    assert.equal(event.paidFor, `Pinewood Derby ${counter} (Nov 7, 2026) — Ava Smith${counter}`);
    assert.equal(event.deletedByName, "Treasurer Pat");
    assert.equal(event.deletedByUserId, admin.id);
    assert.equal(event.deletionReason, `Event "Pinewood Derby ${counter}" deleted`);
    const group = await recordOf("GUEST_GROUP", s.groupPayment.id);
    assert.equal(group?.capturedBy, "app");
    assert.equal(group?.paidFor, `Pinewood Derby ${counter} (Nov 7, 2026) — guests: Guest Family ${counter}`);

    for (const id of [s.eventPayment.id, s.groupPayment.id]) {
      assert.equal(await db.prisma.paymentRecord.count({ where: { originalId: id } }), 1, "exactly one record");
    }
    assert.equal(await db.prisma.eventPayment.count({ where: { id: s.eventPayment.id } }), 0, "the payment row itself is gone");
  });

  it("hands its reason and actor to the trigger for a payment added after it read", async () => {
    const s = await seed();
    let lateId = "";
    await db.prisma.$transaction(async (tx) => {
      await records.keepPaymentRecords(tx, { tripRegistrationId: s.tripRegistration.id }, {
        session: asSession(admin),
        reason: `Trip registration "Trip Family ${counter}" deleted`,
      });
      const late = await tx.tripPayment.create({
        data: { tripRegistrationId: s.tripRegistration.id, amountCents: 500, paidOn: DAY("2026-10-06") },
      });
      lateId = late.id;
      await tx.tripRegistration.delete({ where: { id: s.tripRegistration.id } });
    });
    assert.equal((await recordOf("TRIP", s.tripPayment.id))?.capturedBy, "app");
    const late = await recordOf("TRIP", lateId);
    assert.ok(late);
    assert.equal(late.capturedBy, "database");
    assert.equal(late.deletionReason, `Trip registration "Trip Family ${counter}" deleted`);
    assert.equal(late.deletedByUserId, admin.id);
    assert.equal(late.deletedByName, "Treasurer Pat");
  });

  it("leaves nothing behind when the delete's transaction rolls back", async () => {
    const s = await seed();
    const before = await db.prisma.paymentRecord.count();
    const result = await settle(
      db.prisma.$transaction(async (tx) => {
        await records.keepPaymentRecords(tx, { scoutIds: [s.scout.id] }, { session: asSession(admin), reason: "Scout deleted" });
        await tx.scout.delete({ where: { id: s.scout.id } });
        throw new Error("something later failed");
      }),
    );
    assert.equal(result.ok, false);
    assert.equal(await db.prisma.paymentRecord.count(), before);
    assert.equal(await db.prisma.duesPayment.count({ where: { id: s.dues.id } }), 1);
    assert.equal(await db.prisma.eventPayment.count({ where: { id: s.eventPayment.id } }), 1);
    // And the transaction-local context didn't leak onto a later delete on another connection.
    await db.prisma.duesPayment.delete({ where: { id: s.dues.id } });
    assert.equal((await recordOf("DUES", s.dues.id))?.deletionReason, "Deleted (reason not recorded)");
  });
});

describe("summarizePayments and the warning", () => {
  it("counts every payment but totals family money only", async () => {
    const s = await seed();
    assert.deepEqual(await records.summarizePayments({ scoutIds: [s.scout.id] }), { count: 2, totalCents: 12500 });
    assert.deepEqual(await records.summarizePayments({ eventId: s.event.id }), { count: 2, totalCents: 5500 });
    assert.deepEqual(await records.summarizePayments({ eventGuestGroupId: s.group.id }), { count: 1, totalCents: 3000 });
    assert.deepEqual(await records.summarizePayments({ tripRegistrationId: s.tripRegistration.id }), { count: 1, totalCents: 4000 });
    // The voided raffle payment is counted, not totaled.
    assert.deepEqual(await records.summarizePayments({ raffleId: s.raffle.id }), { count: 2, totalCents: 2000 });
    // A trip expense is the pack's own spending: counted, never totaled.
    assert.deepEqual(await records.summarizePayments({ tripExpenseId: s.expense.id }), { count: 1, totalCents: 0 });
    assert.deepEqual(await records.summarizePayments({ duesPaymentId: "missing" }), { count: 0, totalCents: 0 });
  });

  it("words the confirm prompt's extra sentence", () => {
    assert.equal(records.paymentDeletionWarning({ count: 0, totalCents: 0 }), "");
    const one = records.paymentDeletionWarning({ count: 1, totalCents: 4500 });
    assert.match(one, /^ ⚠ This has 1 payment totaling \$45\.00 attached\./);
    assert.match(one, /Admin → Payment Records/);
    assert.match(records.paymentDeletionWarning({ count: 3, totalCents: 0 }), /^ ⚠ This has 3 payments attached\./);
  });
});

describe("recording an outcome (resolvePaymentRecordAction)", () => {
  async function keptRecord(overrides: Partial<{ amountCents: number; paidBy: string }> = {}) {
    counter += 1;
    return db.prisma.paymentRecord.create({
      data: {
        kind: "DUES",
        originalId: `orig-${counter}`,
        amountCents: overrides.amountCents ?? 4500,
        paidOn: DAY("2026-09-01"),
        paidBy: overrides.paidBy ?? "Ava Smith",
        paidFor: `Dues — Ava Smith (Bear 2026-2027) #${counter}`,
        deletionReason: "Scout Ava Smith deleted",
        deletedByName: "Treasurer Pat",
      },
    });
  }
  const resolve = (user: SessionUser, values: Record<string, string>) =>
    runAs(user, () => actions.resolvePaymentRecordAction(form(values)));

  it("marks a record refunded with the amount and date, and audits it in Dues & Payments", async () => {
    const record = await keptRecord();
    const result = await resolve(admin, {
      id: record.id,
      version: "new",
      status: "REFUNDED",
      refundedAmount: "45",
      refundedOn: "2026-10-20",
      note: "Zelle back to mom",
    });
    assert.deepEqual(result, {});
    const after = await db.prisma.paymentRecord.findUniqueOrThrow({ where: { id: record.id } });
    assert.equal(after.status, "REFUNDED");
    assert.equal(after.refundedCents, 4500);
    assert.equal(after.refundedOn?.toISOString().slice(0, 10), "2026-10-20");
    assert.equal(after.resolutionNote, "Zelle back to mom");
    assert.equal(after.resolvedByName, "Treasurer Pat");
    assert.ok(after.resolvedAt);
    assert.ok(testState.revalidated.includes("/portal/admin/payment-records"));

    const audit = await db.prisma.auditLog.findFirstOrThrow({ where: { entityId: record.id } });
    assert.equal(audit.action, "paymentRecord.resolve");
    assert.equal(audit.category, "paymentRecord");
    assert.match(audit.summary, /^Marked refunded \(\$45\.00 on Oct 20, 2026\) — \$45\.00 for Dues — Ava Smith/);
    const { getAuditLogPage } = await import("@/lib/auditLogData");
    const tab = await getAuditLogPage({ tab: "dues", page: 1, pageSize: 100, category: "paymentRecord" });
    assert.ok(tab.entries.some((e) => e.entityId === record.id), "listed on the Dues & Payments tab");

    // Changing it to anything else clears the refund, even with the old amount still in the form.
    const kept = await resolve(admin, {
      id: record.id,
      version: after.resolvedAt!.toISOString(),
      status: "KEPT_BY_PACK",
      refundedAmount: "45",
      refundedOn: "2026-10-20",
      note: "",
    });
    assert.deepEqual(kept, {});
    const again = await db.prisma.paymentRecord.findUniqueOrThrow({ where: { id: record.id } });
    assert.equal(again.status, "KEPT_BY_PACK");
    assert.equal(again.refundedCents, null);
    assert.equal(again.refundedOn, null);
    assert.equal(again.resolutionNote, null);
  });

  it("allows a partial refund", async () => {
    const record = await keptRecord({ amountCents: 10000 });
    const result = await resolve(admin, { id: record.id, version: "new", status: "REFUNDED", refundedAmount: "60.50", refundedOn: "2026-10-01" });
    assert.deepEqual(result, {});
    assert.equal((await db.prisma.paymentRecord.findUniqueOrThrow({ where: { id: record.id } })).refundedCents, 6050);
  });

  it("refuses a bad refund, an unknown status, a long note and a stale form — saving nothing", async () => {
    const record = await keptRecord();
    const base = { id: record.id, version: "new", status: "REFUNDED", refundedAmount: "45", refundedOn: "2026-10-20" };
    const cases: [Record<string, string>, RegExp][] = [
      [{ ...base, refundedAmount: "" }, /Enter how much was refunded/],
      [{ ...base, refundedAmount: "0" }, /more than \$0\.00/],
      [{ ...base, refundedAmount: "-5" }, /dollar amount/],
      [{ ...base, refundedAmount: "1e3" }, /dollar amount/],
      [{ ...base, refundedAmount: "45.01" }, /can't be more than the \$45\.00 that was paid/],
      [{ ...base, refundedOn: "" }, /Enter the date it was refunded/],
      [{ ...base, refundedOn: "2026-02-30" }, /isn't a real date/],
      [{ ...base, refundedOn: `${new Date().getUTCFullYear() + 1}-01-01` }, /can't be in the future/],
      [{ ...base, status: "PAID" }, /Choose what happened/],
      [{ ...base, note: "x".repeat(2001) }, /at most 2000 characters/],
      [{ ...base, note: "a\u0000b" }, /NUL/],
      [{ ...base, version: "2026-01-01T00:00:00.000Z" }, /Someone else recorded an outcome/],
      [{ ...base, version: "" }, /Someone else recorded an outcome/],
      [{ ...base, id: "no-such-record" }, /no longer exists/],
      [{ ...base, id: "" }, /Missing payment record id/],
    ];
    for (const [values, message] of cases) {
      const result = await resolve(admin, values);
      assert.match(result.error ?? "(saved)", message, JSON.stringify(values).slice(0, 120));
    }
    const after = await db.prisma.paymentRecord.findUniqueOrThrow({ where: { id: record.id } });
    assert.equal(after.status, "NEEDS_DECISION");
    assert.equal(after.resolvedAt, null);
    assert.equal(await db.prisma.auditLog.count({ where: { entityId: record.id } }), 0);
  });

  it("refuses everyone but an Admin", async () => {
    const record = await keptRecord();
    for (const user of [juniorAdmin, committee]) {
      const result = await settle(resolve(user, { id: record.id, version: "new", status: "KEPT_BY_PACK" }));
      assert.equal(result.ok, false);
    }
    const anonymous = await settle(actions.resolvePaymentRecordAction(form({ id: record.id, version: "new", status: "KEPT_BY_PACK" })));
    assert.equal(anonymous.ok, false);
    assert.equal((await db.prisma.paymentRecord.findUniqueOrThrow({ where: { id: record.id } })).status, "NEEDS_DECISION");
  });
});

describe("the page and its CSV export", () => {
  const call = (user: SessionUser, query = "") =>
    runAs(user, () => exportRoute.GET(new Request(`https://portal.pack376nyc.org/portal/admin/payment-records/export${query}`)));

  it("gives an Admin a private CSV of the selected tab, safe from spreadsheet formulas", async () => {
    counter += 1;
    const tag = `csv-${counter}`;
    await db.prisma.paymentRecord.create({
      data: {
        kind: "TRIP",
        originalId: `${tag}-a`,
        amountCents: 4000,
        paidBy: "=HYPERLINK(\"http://evil.example\")",
        paidFor: `Camp ${tag}`,
        deletionReason: "Trip registration deleted",
        details: { contactEmail: "fam@example.test", contactPhone: "(718) 555-0100" },
      },
    });
    await db.prisma.paymentRecord.create({
      data: {
        kind: "DUES",
        originalId: `${tag}-b`,
        amountCents: 1000,
        paidFor: `Refunded ${tag}`,
        deletionReason: "Payment deleted",
        status: "REFUNDED",
        refundedCents: 1000,
        refundedOn: DAY("2026-10-10"),
      },
    });

    const response = await call(admin);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.match(response.headers.get("Content-Type") ?? "", /^text\/csv/);
    assert.match(response.headers.get("Content-Disposition") ?? "", /^attachment; filename="payment-records-needs-decision-\d{4}-\d{2}-\d{2}\.csv"$/);
    const csv = await response.text();
    assert.match(csv.split("\r\n")[0], /^Status,Type,Paid For,Paid By,Amount/);
    assert.ok(csv.includes(`Camp ${tag}`));
    assert.ok(csv.includes(`"'=HYPERLINK(""http://evil.example"")"`), "formula neutralized");
    assert.ok(csv.includes("fam@example.test"));
    assert.ok(!csv.includes(`Refunded ${tag}`), "default tab is Needs decision");

    const refunded = await (await call(admin, "?status=refunded")).text();
    assert.ok(refunded.includes(`Refunded ${tag}`));
    assert.ok(refunded.includes("10.00,2026-10-10"));
    assert.ok(!refunded.includes(`Camp ${tag}`));

    const all = await (await call(admin, "?status=all")).text();
    assert.ok(all.includes(`Camp ${tag}`) && all.includes(`Refunded ${tag}`));
  });

  it("sends every other role away from the export and the page", async () => {
    for (const user of [juniorAdmin, committee]) {
      const exported = await settle(call(user));
      assert.equal(exported.ok, false);
      assert.ok((exported as { error: Error & { redirect?: string } }).error.redirect, "redirected");
      const opened = await settle(runAs(user, () => page.default({ searchParams: Promise.resolve({}) })));
      assert.equal(opened.ok, false);
      assert.ok((opened as { error: Error & { redirect?: string } }).error.redirect, "redirected");
    }
    const rendered = await settle(runAs(admin, () => page.default({ searchParams: Promise.resolve({ status: "all" }) })));
    assert.equal(rendered.ok, true);
  });

  it("the proxy lets only Admins through to the page and the export", async () => {
    async function allows(user: SessionUser, path: string) {
      const { token } = await sessionModule.signSession({
        userId: user.id,
        role: user.role,
        denIds: [],
        scoutIds: [],
        displayName: "Proxy test",
        sv: user.sessionVersion,
      });
      const request = new nextServer.NextRequest(`https://pack376nyc.org${path}`, {
        headers: { cookie: `${sessionModule.SESSION_COOKIE}=${token}` },
      });
      const response = await proxyModule.proxy(request);
      return !response.headers.get("location");
    }
    for (const path of ["/portal/admin/payment-records", "/portal/admin/payment-records/export"]) {
      assert.equal(await allows(admin, path), true, `Admin ${path}`);
      assert.equal(await allows(juniorAdmin, path), false, `Junior Admin ${path}`);
      assert.equal(await allows(committee, path), false, `Committee ${path}`);
    }
  });
});
