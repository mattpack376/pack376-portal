/*
 * F7 on the Admin side and the rest of the event money forms: an Admin's
 * higher, explicit guest-group ceiling; bounds on amounts, notes and dates;
 * scout sign-ups (Admin and parent); and the guest withdrawal-vs-payment race,
 * which has to keep working now that recording a payment takes the same lock.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, describe, it } from "node:test";
import { openTransaction, waitForLockWait, withTestDatabase } from "../support/db";
import { form, resetTestState, runAs, settle, testState, type SessionUser } from "../support/context";
import { packFixtures } from "./fixtures/pack";

const db = withTestDatabase("event_admin_forms");
let events: typeof import("@/lib/actions/events");
let guestGroupEditVersion: typeof import("@/lib/eventEditVersion").guestGroupEditVersion;
let registrationEditVersion: typeof import("@/lib/eventEditVersion").registrationEditVersion;
let fx: ReturnType<typeof packFixtures>;
let admin: SessionUser;

before(async () => {
  await db.ready;
  events = await import("@/lib/actions/events");
  ({ guestGroupEditVersion, registrationEditVersion } = await import("@/lib/eventEditVersion"));
  fx = packFixtures(db.prisma);
  admin = await fx.user("ADMIN");
});

beforeEach(() => resetTestState());

async function writeCounts() {
  const [groups, registrations, payments, groupPayments, audits] = await Promise.all([
    db.prisma.eventGuestGroup.count(),
    db.prisma.eventRegistration.count(),
    db.prisma.eventPayment.count(),
    db.prisma.eventGuestGroupPayment.count(),
    db.prisma.auditLog.count(),
  ]);
  return { groups, registrations, payments, groupPayments, audits };
}

type Fields = Record<string, string | number | string[] | undefined>;

/**
 * The guest group's edit form as its page fills it in: `version` is the
 * fingerprint of the group as it's saved now (unless `fields` says otherwise).
 */
async function editGroup(eventId: string, guestGroupId: string, fields: Fields) {
  const saved = await db.prisma.eventGuestGroup.findUniqueOrThrow({ where: { id: guestGroupId } });
  return runAs(admin, () =>
    events.updateGuestGroupAction(form({ guestGroupId, eventId, version: guestGroupEditVersion(saved), ...fields })),
  );
}

function addGroup(eventId: string, fields: Fields, as: SessionUser = admin) {
  return runAs(as, () =>
    events.addGuestGroupAction(
      form({ eventId, submissionKey: randomUUID(), familyName: "Visitors", amountOwed: "0", ...fields }),
    ),
  );
}

describe("Admin guest groups", () => {
  it("enters a group of up to 200 people at the amount typed, with an audit entry in the same commit", async () => {
    const event = await fx.event();
    const den = await fx.den("BEAR");
    const scout = await fx.scout(den.id);

    const result = await addGroup(event.id, {
      familyName: "Visiting Troop 12",
      adultCount: 150,
      childCount: 50,
      amountOwed: "1234.50",
      guestOf: `scout:${scout.id}`,
    });
    assert.deepEqual(result, {});
    const group = await db.prisma.eventGuestGroup.findFirstOrThrow({ where: { eventId: event.id } });
    assert.equal(group.adultCount + group.childCount, 200);
    assert.equal(group.amountOwedCents, 123_450);
    assert.equal(group.guestOfScoutId, scout.id);
    assert.equal(group.addedByUserId, null);
    assert.ok(await db.prisma.auditLog.findFirst({ where: { action: "guestGroup.create", entityId: group.id } }));
  });

  it("refuses more than 200 people, bad amounts, oversize names and unknown Guest Of links, writing nothing", async () => {
    const event = await fx.event();
    const counts = await writeCounts();
    const refusals: [Fields, RegExp][] = [
      [{ adultCount: 150, childCount: 51 }, /at most 200 people/],
      [{ adultCount: 201 }, /at most 200 people/],
      [{ childCount: "1e3" }, /as a whole number/],
      [{ adultCount: "0x10" }, /as a whole number/],
      [{ adultCount: "2.0" }, /as a whole number/],
      [{ adultCount: 0, childCount: 0 }, /at least one adult or child/],
      [{ adultCount: 1, amountOwed: "1e3" }, /amount owed/],
      [{ adultCount: 1, amountOwed: "1000000.01" }, /amount owed/],
      [{ adultCount: 1, amountOwed: "-5" }, /amount owed/],
      [{ adultCount: 1, amountOwed: "" }, /amount owed/],
      [{ adultCount: 1, familyName: "n".repeat(121) }, /120 characters/],
      [{ adultCount: 1, guestOf: "scout:does-not-exist" }, /no longer on the roster/],
      [{ adultCount: 1, guestOf: "user:does-not-exist" }, /no longer exists/],
      [{ adultCount: 1, guestOf: "users" }, /Guest Of option/],
      [{ adultCount: 1, guestOf: "family:abc" }, /Guest Of option/],
      [{ adultCount: 1, submissionKey: "" }, /already used or is out of date/],
    ];
    for (const [fields, message] of refusals) {
      const result = await addGroup(event.id, fields);
      assert.match(result.error ?? "(no error)", message, JSON.stringify(fields));
    }
    assert.deepEqual(await writeCounts(), counts);
  });

  it("adds one group when the same Add is sent twice, and is Admin-only", async () => {
    const event = await fx.event();
    const key = randomUUID();
    assert.deepEqual(await addGroup(event.id, { adultCount: 2, submissionKey: key }), {});
    assert.deepEqual(await addGroup(event.id, { adultCount: 2, submissionKey: key }), {});
    assert.equal(await db.prisma.eventGuestGroup.count({ where: { eventId: event.id } }), 1);

    const juniorAdmin = await fx.user("JUNIOR_ADMIN");
    assert.equal((await settle(addGroup(event.id, { adultCount: 1 }, juniorAdmin))).ok, false);
    assert.equal(await db.prisma.eventGuestGroup.count({ where: { eventId: event.id } }), 1);
  });

  it("holds an edit to the same ceiling and bounds, changing nothing when it refuses", async () => {
    const event = await fx.event();
    await addGroup(event.id, { familyName: "Before", adultCount: 2, amountOwed: "20" });
    const group = await db.prisma.eventGuestGroup.findFirstOrThrow({ where: { eventId: event.id } });
    const edit = (fields: Fields) => editGroup(event.id, group.id, { familyName: "After", adultCount: 3, amountOwed: "30", ...fields });

    resetTestState();
    for (const [fields, message] of [
      [{ adultCount: 201 }, /at most 200 people/],
      [{ adultCount: 100, childCount: 101 }, /at most 200 people/],
      [{ adultCount: "1e2" }, /as a whole number/],
      [{ familyName: "n".repeat(121) }, /120 characters/],
      [{ amountOwed: "1e3" }, /amount owed/],
      [{ guestOf: "scout:does-not-exist" }, /no longer on the roster/],
      [{ guestOf: "family:abc" }, /Guest Of option/],
    ] as [Fields, RegExp][]) {
      // Shown on the form, with the Admin's entries put back over the page.
      const result = await edit(fields);
      assert.match(result.error ?? "(no error)", message, JSON.stringify(fields));
      assert.equal(result.stale, undefined, JSON.stringify(fields));
    }
    assert.deepEqual(testState.revalidated, [], "a refusal about the entries doesn't refresh the page under them");
    const unchanged = await db.prisma.eventGuestGroup.findUniqueOrThrow({ where: { id: group.id } });
    assert.equal(unchanged.familyName, "Before");
    assert.equal(unchanged.adultCount, 2);
    assert.equal(await db.prisma.auditLog.count({ where: { action: "guestGroup.update" } }), 0);

    await edit({ adultCount: 120, childCount: 80, amountOwed: "2000" });
    const edited = await db.prisma.eventGuestGroup.findUniqueOrThrow({ where: { id: group.id } });
    assert.equal(edited.familyName, "After");
    assert.equal(edited.adultCount + edited.childCount, 200);
    assert.equal(edited.amountOwedCents, 200_000);
    const audit = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "guestGroup.update", entityId: group.id } });
    assert.match(JSON.stringify(audit.details), /\$20\.00/);
  });
});

describe("an edit from a page loaded before another Admin's change", () => {
  async function pricedGroup() {
    const event = await fx.event();
    await addGroup(event.id, { familyName: "The Smiths", adultCount: 2, childCount: 1, amountOwed: "25.00" });
    const group = await db.prisma.eventGuestGroup.findFirstOrThrow({ where: { eventId: event.id } });
    return { event, group, loaded: guestGroupEditVersion(group) };
  }

  it("refuses a guest group edit that would put back the amount owed another Admin changed", async () => {
    const { event, group, loaded } = await pricedGroup();
    // Admin B gives the family a discount.
    const discount = await editGroup(event.id, group.id, { familyName: "The Smiths", adultCount: 2, childCount: 1, amountOwed: "15.00" });
    const audits = await db.prisma.auditLog.count({ where: { action: "guestGroup.update", entityId: group.id } });
    resetTestState();

    // Admin A, from the page loaded before that, fixes the name: the form
    // resends the amount it loaded with.
    const stale = await editGroup(event.id, group.id, {
      version: loaded,
      familyName: "The Smith Family",
      adultCount: 2,
      childCount: 1,
      amountOwed: "25.00",
    });
    const kept = await db.prisma.eventGuestGroup.findUniqueOrThrow({ where: { id: group.id } });
    assert.equal(kept.amountOwedCents, 1500, "the discount stands");
    assert.equal(kept.familyName, "The Smiths");
    assert.deepEqual(discount, {});
    assert.equal(stale.stale, true);
    assert.match(stale.error ?? "", /Someone changed this guest group after this page loaded/);
    assert.match(stale.error ?? "", /The Smiths: 2 adults, 1 kid, \$15\.00 owed/);
    assert.equal(await db.prisma.auditLog.count({ where: { action: "guestGroup.update", entityId: group.id } }), audits);
    assert.ok(testState.revalidated.includes(`/portal/admin/events/${event.id}/guests/${group.id}`), "the page is refreshed");

    // The refreshed page carries the current version: the fix goes through.
    assert.deepEqual(
      await editGroup(event.id, group.id, { familyName: "The Smith Family", adultCount: 2, childCount: 1, amountOwed: "15.00" }),
      {},
    );
    const fixed = await db.prisma.eventGuestGroup.findUniqueOrThrow({ where: { id: group.id } });
    assert.equal(fixed.familyName, "The Smith Family");
    assert.equal(fixed.amountOwedCents, 1500);
  });

  it("checks the version under the group's lock, against a change that commits while it waits", async (t) => {
    const { event, group, loaded } = await pricedGroup();
    const other = await openTransaction(db.pool);
    t.after(() => other.rollback());
    await other.query(`SELECT id FROM "EventGuestGroup" WHERE id = $1 FOR UPDATE`, [group.id]);
    await other.query(`UPDATE "EventGuestGroup" SET "amountOwedCents" = 1000 WHERE id = $1`, [group.id]);

    const pending = editGroup(event.id, group.id, {
      version: loaded,
      familyName: "Renamed",
      adultCount: 2,
      childCount: 1,
      amountOwed: "25.00",
    });
    await waitForLockWait(db.pool);
    await other.commit();

    const result = await pending;
    assert.equal(result.stale, true);
    const saved = await db.prisma.eventGuestGroup.findUniqueOrThrow({ where: { id: group.id } });
    assert.deepEqual([saved.familyName, saved.amountOwedCents], ["The Smiths", 1000]);
  });

  it("stays usable while payments are recorded, and refuses a form with no version or a removed group", async () => {
    const { event, group, loaded } = await pricedGroup();
    assert.deepEqual(
      await runAs(admin, () => events.addGuestGroupPaymentAction(form({ guestGroupId: group.id, eventId: event.id, amount: "5" }))),
      {},
    );
    const fields = { familyName: "The Smiths", adultCount: 3, childCount: 1, amountOwed: "35.00" };
    assert.deepEqual(await editGroup(event.id, group.id, { version: loaded, ...fields }), {});
    assert.equal((await db.prisma.eventGuestGroup.findUniqueOrThrow({ where: { id: group.id } })).amountOwedCents, 3500);

    // A page from before this check (or a hand-built request) has no version.
    const noVersion = await editGroup(event.id, group.id, { ...fields, version: "", amountOwed: "1.00" });
    assert.equal(noVersion.stale, true);
    assert.equal((await db.prisma.eventGuestGroup.findUniqueOrThrow({ where: { id: group.id } })).amountOwedCents, 3500);

    // A removed group is said so on the page as it loaded: not stale, since
    // refreshed, the group's page could only show not-found in its place.
    await db.prisma.eventGuestGroup.delete({ where: { id: group.id } });
    resetTestState();
    const gone = await runAs(admin, () =>
      events.updateGuestGroupAction(form({ guestGroupId: group.id, eventId: event.id, version: loaded, ...fields })),
    );
    assert.deepEqual(gone, {
      error: "This guest group no longer exists — someone may have just removed it. Nothing was saved.",
    });
    assert.deepEqual(testState.revalidated, []);
  });

  it("refuses a scout's amount owed saved over another Admin's change, and saves it from a current page", async () => {
    const event = await fx.event();
    const den = await fx.den("BEAR");
    const scout = await fx.scout(den.id);
    const registration = await db.prisma.eventRegistration.create({
      data: { eventId: event.id, scoutId: scout.id, amountOwedCents: 4000 },
    });
    const loaded = registrationEditVersion(registration);
    const setAmount = (amountOwed: string, version: string, as: SessionUser = admin) =>
      runAs(as, () =>
        events.updateRegistrationAmountAction(form({ registrationId: registration.id, eventId: event.id, amountOwed, version })),
      );

    // Admin B corrects the amount; Admin A, from the page loaded before
    // that, enters another.
    const correction = await setAmount("30.00", loaded);
    resetTestState();
    const stale = await setAmount("35.00", loaded);
    assert.equal(
      (await db.prisma.eventRegistration.findUniqueOrThrow({ where: { id: registration.id } })).amountOwedCents,
      3000,
      "the correction stands",
    );
    assert.deepEqual(correction, {});
    assert.equal(stale.stale, true);
    assert.match(stale.error ?? "", /Someone changed this amount owed after this page loaded \(it's now \$30\.00\)/);
    assert.ok(testState.revalidated.includes(`/portal/admin/events/${event.id}/${registration.id}`), "the page is refreshed");

    // A mistake in the amount is shown on the form, without refreshing it.
    resetTestState();
    const current = registrationEditVersion({ amountOwedCents: 3000 });
    for (const typed of ["", "1e3", "-5", "1000000.01"]) {
      const refused = await setAmount(typed, current);
      assert.match(refused.error ?? "(no error)", /amount owed/, typed);
      assert.equal(refused.stale, undefined, typed);
    }
    assert.deepEqual(testState.revalidated, []);
    assert.equal((await setAmount("1.00", "")).stale, true, "no version: a page from before this check");

    // From the refreshed page it saves, with an audit entry in the same commit.
    assert.deepEqual(await setAmount("35.00", current), {});
    assert.equal((await db.prisma.eventRegistration.findUniqueOrThrow({ where: { id: registration.id } })).amountOwedCents, 3500);
    const audits = await db.prisma.auditLog.findMany({
      where: { action: "eventRegistration.updateAmount", entityId: registration.id },
    });
    assert.equal(audits.length, 2, "one for each save that went through");
    const latest = audits.find((audit) => /to \$35\.00/.test(audit.summary));
    assert.ok(latest);
    assert.match(JSON.stringify(latest.details), /\$30\.00/);
    assert.equal(latest.denId, den.id);

    // Recording a payment leaves the page's version current.
    assert.deepEqual(
      await runAs(admin, () =>
        events.addEventPaymentAction(form({ registrationId: registration.id, eventId: event.id, amount: "10" })),
      ),
      {},
    );
    assert.deepEqual(await setAmount("32.00", registrationEditVersion({ amountOwedCents: 3500 })), {});

    // Admin-only, and a removed registration is reported as such.
    const juniorAdmin = await fx.user("JUNIOR_ADMIN");
    const notAdmin = await settle(setAmount("1.00", registrationEditVersion({ amountOwedCents: 3200 }), juniorAdmin));
    assert.equal(notAdmin.ok, false);
    assert.equal((await db.prisma.eventRegistration.findUniqueOrThrow({ where: { id: registration.id } })).amountOwedCents, 3200);
    // Not stale: refreshed, the registration's page could only show not-found
    // in place of the message.
    await db.prisma.eventRegistration.delete({ where: { id: registration.id } });
    resetTestState();
    assert.deepEqual(await setAmount("1.00", current), {
      error: "This registration no longer exists — someone may have just removed it. Nothing was saved.",
    });
    assert.deepEqual(testState.revalidated, []);
  });
});

describe("recording payments", () => {
  it("refuses a malformed amount, an impossible date or an oversize note, writing nothing", async () => {
    const event = await fx.event();
    const den = await fx.den("LION");
    const scout = await fx.scout(den.id);
    const registration = await db.prisma.eventRegistration.create({
      data: { eventId: event.id, scoutId: scout.id, amountOwedCents: 2500 },
    });
    await addGroup(event.id, { adultCount: 1, amountOwed: "10" });
    const group = await db.prisma.eventGuestGroup.findFirstOrThrow({ where: { eventId: event.id } });

    const counts = await writeCounts();
    const refusals: [Fields, RegExp][] = [
      [{ amount: "1e3" }, /payment amount above \$0/],
      [{ amount: "0" }, /payment amount above \$0/],
      [{ amount: "-10" }, /payment amount above \$0/],
      [{ amount: "1000000.01" }, /payment amount above \$0/],
      [{ amount: "10", paidOn: "2026-02-31" }, /isn't a real date/],
      [{ amount: "10", note: "n".repeat(2001) }, /2000 characters/],
    ];
    for (const [fields, message] of refusals) {
      const forScout = await runAs(admin, () =>
        events.addEventPaymentAction(form({ registrationId: registration.id, eventId: event.id, ...fields })),
      );
      assert.match(forScout.error ?? "(no error)", message, JSON.stringify(fields));
      const forGroup = await runAs(admin, () =>
        events.addGuestGroupPaymentAction(form({ guestGroupId: group.id, eventId: event.id, ...fields })),
      );
      assert.match(forGroup.error ?? "(no error)", message, JSON.stringify(fields));
    }
    assert.deepEqual(await writeCounts(), counts);

    const note = "n".repeat(2000);
    assert.deepEqual(
      await runAs(admin, () =>
        events.addEventPaymentAction(
          form({ registrationId: registration.id, eventId: event.id, amount: "12.50", paidOn: "2026-10-01", note }),
        ),
      ),
      {},
    );
    const payment = await db.prisma.eventPayment.findFirstOrThrow({ where: { eventRegistrationId: registration.id } });
    assert.equal(payment.amountCents, 1250);
    assert.equal(payment.note, note);
    assert.equal(payment.recordedByUserId, admin.id);
    assert.ok(await db.prisma.auditLog.findFirst({ where: { action: "eventPayment.add", entityId: payment.id } }));

    const leader = await fx.user("DEN", { denIds: [den.id] });
    const notAdmin = await settle(
      runAs(leader, () =>
        events.addEventPaymentAction(form({ registrationId: registration.id, eventId: event.id, amount: "1" })),
      ),
    );
    assert.equal(notAdmin.ok, false);
  });
});

describe("withdrawing a guest group vs recording a payment against it", () => {
  async function parentGroup() {
    const den = await fx.den("WEBELOS");
    const scout = await fx.scout(den.id);
    const parent = await fx.user("PARENT", { scoutIds: [scout.id] });
    const event = await fx.event();
    const result = await runAs(parent, () =>
      events.registerMyGuestGroupForEventAction(
        form({ eventId: event.id, submissionKey: randomUUID(), familyName: "Withdrawing", adultCount: 1 }),
      ),
    );
    assert.deepEqual(result, {});
    const group = await db.prisma.eventGuestGroup.findFirstOrThrow({ where: { eventId: event.id } });
    return { parent, event, group };
  }

  const withdraw = (parent: SessionUser, guestGroupId: string) =>
    runAs(parent, () => events.removeMyGuestGroupAction(form({ guestGroupId })));
  const pay = (eventId: string, guestGroupId: string) =>
    runAs(admin, () => events.addGuestGroupPaymentAction(form({ guestGroupId, eventId, amount: "10" })));

  it("refuses the withdrawal when a payment commits first", async (t) => {
    const { parent, group } = await parentGroup();
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(
      `INSERT INTO "EventGuestGroupPayment" (id, "eventGuestGroupId", "amountCents", "paidOn") VALUES ($1, $2, 1000, CURRENT_DATE)`,
      [`payment-${randomUUID()}`, group.id],
    );
    const pending = settle(withdraw(parent, group.id));
    await waitForLockWait(db.pool);
    await holder.commit();

    const outcome = await pending;
    assert.equal(outcome.ok, false);
    // The parent-facing refusal deliberately doesn't mention payments (parents don't see what the pack has collected).
    assert.match(outcome.ok ? "" : outcome.error.message, /can't be removed here/);
    assert.doesNotMatch(outcome.ok ? "" : outcome.error.message, /payment/i);
    assert.ok(await db.prisma.eventGuestGroup.findUnique({ where: { id: group.id } }));
    assert.equal(await db.prisma.eventGuestGroupPayment.count({ where: { eventGuestGroupId: group.id } }), 1);
  });

  it("turns the payment away, readably, when the withdrawal commits first", async (t) => {
    const { event, group } = await parentGroup();
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(`SELECT id FROM "EventGuestGroup" WHERE id = $1 FOR UPDATE`, [group.id]);
    await holder.query(`DELETE FROM "EventGuestGroup" WHERE id = $1`, [group.id]);
    const pending = pay(event.id, group.id);
    await waitForLockWait(db.pool);
    await holder.commit();

    assert.match((await pending).error ?? "", /no longer exists/);
    assert.equal(await db.prisma.eventGuestGroupPayment.count({ where: { eventGuestGroupId: group.id } }), 0);
  });

  it("holds under repetition: 20 rounds of a real withdrawal and a real payment at once", async () => {
    for (let round = 0; round < 20; round++) {
      const { parent, event, group } = await parentGroup();
      const [withdrawal, payment] = await Promise.all([settle(withdraw(parent, group.id)), pay(event.id, group.id)]);
      const stillThere = await db.prisma.eventGuestGroup.findUnique({ where: { id: group.id } });
      const payments = await db.prisma.eventGuestGroupPayment.count({ where: { eventGuestGroupId: group.id } });
      if (stillThere) {
        // Payment first: it stands, and the withdrawal was refused.
        assert.deepEqual(payment, {}, `round ${round}`);
        assert.equal(withdrawal.ok, false, `round ${round}`);
        assert.equal(payments, 1, `round ${round}`);
      } else {
        // Withdrawal first: no payment was taken for a group that's gone.
        assert.equal(withdrawal.ok, true, `round ${round}`);
        assert.match(payment.error ?? "", /no longer exists/, `round ${round}`);
        assert.equal(payments, 0, `round ${round}`);
      }
    }
  });
});

describe("scout sign-ups", () => {
  async function familyOfTwo() {
    const den = await fx.den("WOLF");
    const first = await fx.scout(den.id);
    const second = await fx.scout(den.id);
    const parent = await fx.user("PARENT", { scoutIds: [first.id, second.id] });
    return { parent, first, second, den };
  }

  const register = (parent: SessionUser, eventId: string, scoutId: string[]) =>
    runAs(parent, () => events.registerMyScoutsForEventAction(form({ eventId, scoutId })));

  it("registers a family's scouts once each at the event fee, even if a scout is sent twice", async () => {
    const { parent, first, second } = await familyOfTwo();
    const event = await fx.event({ feeCents: 4000 });
    assert.deepEqual(await register(parent, event.id, [first.id, second.id, first.id]), {});
    const registrations = await db.prisma.eventRegistration.findMany({ where: { eventId: event.id } });
    assert.equal(registrations.length, 2);
    assert.ok(registrations.every((r) => r.amountOwedCents === 4000));
    assert.ok(await db.prisma.auditLog.findFirst({ where: { action: "eventRegistration.selfRegister", entityId: event.id } }));
  });

  it("answers ordinary mistakes on the form and still refuses another family's scout", async () => {
    const { parent, first, den } = await familyOfTwo();
    const event = await fx.event();
    const hidden = await fx.event({ visible: false });
    const noFee = await fx.event({ feeCents: null });
    const stranger = await fx.scout(den.id);

    assert.match((await register(parent, event.id, [])).error ?? "", /Select at least one scout/);
    assert.match((await register(parent, hidden.id, [first.id])).error ?? "", /isn't open/);
    assert.match((await register(parent, noFee.id, [first.id])).error ?? "", /isn't open/);
    assert.equal((await settle(register(parent, event.id, [stranger.id]))).ok, false);

    await db.prisma.scout.update({ where: { id: first.id }, data: { active: false } });
    assert.match((await register(parent, event.id, [first.id])).error ?? "", /inactive/);
    assert.equal(await db.prisma.eventRegistration.count({ where: { eventId: event.id } }), 0);
  });

  it("lets an Admin register checked scouts at a typed amount, answering mistakes on the form", async () => {
    const den = await fx.den("BEAR");
    const a = await fx.scout(den.id);
    const b = await fx.scout(den.id);
    const event = await fx.event();
    const registerAs = (fields: Fields) =>
      runAs(admin, () => events.registerScoutForEventAction(form({ eventId: event.id, ...fields })));

    assert.match((await registerAs({ amountOwed: "10" })).error ?? "", /Check at least one scout/);
    assert.match((await registerAs({ scoutId: [a.id], amountOwed: "1e3" })).error ?? "", /amount owed/);
    assert.match((await registerAs({ scoutId: ["missing"], amountOwed: "10" })).error ?? "", /no longer on the roster/);
    assert.deepEqual(await registerAs({ scoutId: [a.id, b.id, a.id], amountOwed: "15" }), {});
    assert.match((await registerAs({ scoutId: [a.id], amountOwed: "15" })).error ?? "", /already registered/);
    assert.equal(await db.prisma.eventRegistration.count({ where: { eventId: event.id, amountOwedCents: 1500 } }), 2);
  });
});
