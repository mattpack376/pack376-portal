/*
 * The public registration form's existing protections — replay, the
 * per-address cap, the honeypot, the rate limit, input bounds, closed trips —
 * kept working now that it takes the trip's lock, and the same bounds on the
 * two admin forms. Real Postgres. (The trip details form's flyer handling is
 * in tripFlyerSave.test.ts.)
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { openTransaction, withTestDatabase } from "../support/db";
import { asAnonymous, form, resetTestState, settle, testState, type SessionUser } from "../support/context";
import {
  addByHand,
  createUser,
  editRegistration,
  familyForm,
  freshTrip,
  loadTripActions,
  LOCK_TRIP,
  register,
  registrationsOf,
  waitForWaiters,
  type TripActions,
} from "./tripHelpers";

const db = withTestDatabase("trip_registration");
let actions: TripActions;
let admin: SessionUser;

before(async () => {
  await db.ready;
  actions = await loadTripActions();
  admin = await createUser(db.prisma, "ADMIN");
});

beforeEach(() => resetTestState());

describe("the public registration form", () => {
  it("files one row for a resubmitted form, one after another or all at once", async () => {
    const trip = await freshTrip(db.prisma);
    const values = familyForm(trip.id);
    assert.equal((await register(actions, values)).success, true);
    assert.equal((await register(actions, values)).success, true, "a replay reports the same success");
    const burst = await Promise.all(Array.from({ length: 5 }, () => register(actions, values)));
    assert.ok(burst.every((r) => r.success === true));
    assert.equal((await registrationsOf(db.prisma, trip.id)).length, 1);
  });

  it("matches a replay whatever the address's capitalization", async () => {
    const trip = await freshTrip(db.prisma);
    const values = familyForm(trip.id, { contactEmail: "Smith.Family@Example.test" });
    assert.equal((await register(actions, values)).success, true);
    assert.equal((await register(actions, { ...values, contactEmail: "smith.family@example.TEST" })).success, true);
    assert.equal((await registrationsOf(db.prisma, trip.id)).length, 1);
  });

  it("takes a genuinely different second group from the same address", async () => {
    const trip = await freshTrip(db.prisma);
    const values = familyForm(trip.id);
    assert.equal((await register(actions, values)).success, true);
    assert.equal((await register(actions, { ...values, payingCount: 3 })).success, true);
    assert.equal((await register(actions, { ...values, familyName: "The Cousins" })).success, true);
    assert.equal((await registrationsOf(db.prisma, trip.id)).length, 3);
  });

  it("caps one address at 10 registrations, even when they all arrive together", async () => {
    const trip = await freshTrip(db.prisma);
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        register(actions, familyForm(trip.id, { contactEmail: "busy@example.test", familyName: `Group ${i}` })),
      ),
    );
    assert.equal(results.filter((r) => r.success).length, 10);
    for (const refused of results.filter((r) => !r.success)) assert.match(refused.error ?? "", /several registrations/);
    assert.equal((await registrationsOf(db.prisma, trip.id)).length, 10);

    // Another address is unaffected.
    assert.equal((await register(actions, familyForm(trip.id))).success, true);
  });

  it("drops a honeypot submission without a word, and saves nothing", async () => {
    const trip = await freshTrip(db.prisma);
    const result = await register(actions, { ...familyForm(trip.id), website: "http://spam.example" });
    assert.equal(result.success, undefined);
    assert.equal(result.error, undefined);
    assert.equal((await registrationsOf(db.prisma, trip.id)).length, 0);
  });

  it("says to try again when the save itself fails, instead of going to an error page", async (t) => {
    const trip = await freshTrip(db.prisma);
    const values = familyForm(trip.id, { contactEmail: "retry.family@example.test" });
    const logged = t.mock.method(console, "error", () => {});

    // The submission queues behind a lock on the trip, and its query is then
    // cancelled — the same way a transaction timing out or a dropped
    // connection ends it. (The old code let that error through to the
    // generic error page, losing what the family typed.)
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(LOCK_TRIP, [trip.id]);
    const submitting = register(actions, values);
    await waitForWaiters(db.pool, 1);
    const { rows } = await db.pool.query(
      `SELECT pg_cancel_backend(pid) AS cancelled FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
    );
    assert.deepEqual(rows.map((row) => row.cancelled), [true]);
    await holder.rollback();

    const result = await submitting;
    assert.match(result.error ?? "", /couldn't save your registration just now/);
    assert.equal(result.success, undefined);
    assert.equal((await registrationsOf(db.prisma, trip.id)).length, 0, "nothing half-saved");
    assert.equal(logged.mock.callCount(), 1);
    const line = String(logged.mock.calls[0].arguments[0]);
    assert.match(line, /^\[trip registration\] couldn't save a registration/);
    assert.doesNotMatch(line, /retry\.family/, "the log line doesn't repeat the family's details");

    // Trying again goes through, once.
    assert.equal((await register(actions, values)).success, true);
    assert.equal((await register(actions, values)).success, true);
    assert.equal((await registrationsOf(db.prisma, trip.id)).length, 1);
  });

  it("turns away a rate-limited connection before saving anything", async () => {
    const trip = await freshTrip(db.prisma);
    testState.rateLimited = true;
    assert.match((await register(actions, familyForm(trip.id))).error ?? "", /Too many registration attempts/);
    assert.equal((await registrationsOf(db.prisma, trip.id)).length, 0);
  });

  it("refuses out-of-bounds input, naming the field it's about", async () => {
    const trip = await freshTrip(db.prisma, { freeAgeAndUnder: 4 });
    const cases: [Record<string, string | number>, string, RegExp][] = [
      [{ familyName: "x".repeat(121) }, "familyName", /120 characters/],
      [{ guestOfName: "x".repeat(121) }, "guestOfName", /120 characters/],
      [{ familyName: "   " }, "familyName", /required/],
      [{ contactEmail: "a@example.test, b@example.test" }, "contactEmail", /valid email/],
      [{ contactEmail: "Name <a@example.test>" }, "contactEmail", /valid email/],
      [{ contactEmail: `${"a".repeat(250)}@example.test` }, "contactEmail", /valid email/],
      [{ contactPhone: "call me ".repeat(6) }, "contactPhone", /valid phone/],
      [{ affiliation: "SCOUTS" }, "affiliation", /Pack 376 or Troop 376/],
      [{ payingCount: "1e3" }, "payingCount", /Invalid attendee counts/],
      [{ freeCount: "-1" }, "freeCount", /Invalid attendee counts/],
      [{ payingCount: 0, freeCount: 0 }, "payingCount", /at least one attendee/],
      [{ payingCount: 40, freeCount: 11 }, "payingCount", /more than 50 attendees/],
    ];
    for (const [overrides, field, message] of cases) {
      const result = await register(actions, familyForm(trip.id, overrides));
      assert.match(result.error ?? "", message, JSON.stringify(overrides));
      assert.equal(result.field, field, JSON.stringify(overrides));
    }
    // A file where text belongs is just a missing value.
    const withFile = form(familyForm(trip.id));
    withFile.set("familyName", new File(["x"], "name.txt"));
    const { result } = await asAnonymous(() => actions.registration.registerForTripAction({}, withFile));
    assert.equal(result.field, "familyName");
    assert.equal((await registrationsOf(db.prisma, trip.id)).length, 0);

    // Exactly at the limits is fine.
    const atLimits = await register(
      actions,
      familyForm(trip.id, { familyName: "x".repeat(120), payingCount: 40, freeCount: 10 }),
    );
    assert.equal(atLimits.success, true);
  });

  it("refuses unknown, unpublished and past-deadline trips the same way", async () => {
    assert.match((await register(actions, familyForm("no-such-trip"))).error ?? "", /Registration for this trip is closed/);

    const unpublished = await freshTrip(db.prisma, { published: false });
    assert.match((await register(actions, familyForm(unpublished.id))).error ?? "", /Registration for this event is closed/);

    const pastDeadline = await freshTrip(db.prisma, { slug: "camp-conron", priceTbd: false, rsvpDeadline: new Date("2020-01-01T00:00:00Z") });
    assert.match((await register(actions, familyForm(pastDeadline.id))).error ?? "", /Registration for this trip is closed/);

    assert.equal(await db.prisma.tripRegistration.count({ where: { tripPageId: { in: [unpublished.id, pastDeadline.id] } } }), 0);
  });

  it("refuses free attendees on an event with no free tier", async () => {
    const trip = await freshTrip(db.prisma, { freeAgeAndUnder: null });
    const result = await register(actions, familyForm(trip.id, { freeCount: 1 }));
    assert.match(result.error ?? "", /no free-attendee option/);
    assert.equal(result.field, "freeCount");
    assert.equal((await registrationsOf(db.prisma, trip.id)).length, 0);
  });

  it("charges the early-bird rate until its deadline, the regular one after", async () => {
    const early = await freshTrip(db.prisma, {
      slug: "camp-conron",
      priceTbd: false,
      regularPriceCents: 5500,
      earlyBirdPriceCents: 4500,
      earlyBirdDeadline: new Date("2199-01-01T00:00:00Z"),
      freeAgeAndUnder: 4,
    });
    assert.equal((await register(actions, familyForm(early.id, { payingCount: 2, freeCount: 1 }))).success, true);
    const [earlyRow] = await registrationsOf(db.prisma, early.id);
    assert.equal(earlyRow.amountOwedCents, 9000);
    assert.equal(earlyRow.owedPending, false);

    const late = await freshTrip(db.prisma, {
      slug: "camp-conron",
      priceTbd: false,
      regularPriceCents: 5500,
      earlyBirdPriceCents: 4500,
      earlyBirdDeadline: new Date("2020-01-01T00:00:00Z"),
    });
    assert.equal((await register(actions, familyForm(late.id, { payingCount: 2 }))).success, true);
    assert.equal((await registrationsOf(db.prisma, late.id))[0].amountOwedCents, 11000);
  });
});

describe("adding a family by hand", () => {
  it("applies the public form's bounds and says what's wrong", async () => {
    const trip = await freshTrip(db.prisma);
    for (const [overrides, message] of [
      [{ familyName: "x".repeat(121) }, /120 characters/],
      [{ contactEmail: "not-an-address" }, /valid email/],
      [{ contactEmail: "a@example.test; b@example.test" }, /valid email/],
      [{ payingCount: "2.5" }, /Invalid attendee counts/],
      [{ payingCount: 51 }, /more than 50 attendees/],
      [{ affiliation: "" }, /Pack 376 or Troop 376/],
    ] as [Record<string, string | number>, RegExp][]) {
      const result = await addByHand(actions, admin, familyForm(trip.id, overrides));
      assert.match(result.error ?? "", message, JSON.stringify(overrides));
    }
    assert.match((await addByHand(actions, admin, familyForm("no-such-trip"))).error ?? "", /no longer exists/);
    assert.equal((await registrationsOf(db.prisma, trip.id)).length, 0);
  });

  it("is the way in after the form closes, priced now and audited with the row", async () => {
    const trip = await freshTrip(db.prisma, {
      slug: "camp-conron",
      priceTbd: false,
      published: false,
      regularPriceCents: 5500,
      rsvpDeadline: new Date("2020-01-01T00:00:00Z"),
    });
    assert.deepEqual(await addByHand(actions, admin, familyForm(trip.id, { payingCount: 3 })), {});
    const [row] = await registrationsOf(db.prisma, trip.id);
    assert.equal(row.amountOwedCents, 16500);
    const entry = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "tripRegistration.create", entityId: row.id } });
    assert.match(entry.summary, /after the RSVP deadline/);
  });

  it("is Admin-only", async () => {
    const trip = await freshTrip(db.prisma);
    for (const role of ["JUNIOR_ADMIN", "TRIP_VIEWER", "COMMITTEE"] as const) {
      const user = await createUser(db.prisma, role);
      assert.equal((await settle(addByHand(actions, user, familyForm(trip.id)))).ok, false, role);
    }
    assert.equal((await registrationsOf(db.prisma, trip.id)).length, 0);
  });
});

describe("editing a registration", () => {
  async function oneRegistration(overrides: Partial<{ payingCount: number; freeCount: number; owedPending: boolean; amountOwedCents: number }> = {}) {
    const trip = await freshTrip(db.prisma, { freeAgeAndUnder: 4 });
    const registration = await db.prisma.tripRegistration.create({
      data: {
        tripPageId: trip.id,
        familyName: "The Edit Family",
        contactEmail: "edit@example.test",
        contactPhone: "(212)555-0100",
        guestOfName: "Timmy Test",
        affiliation: "PACK",
        payingCount: 2,
        freeCount: 0,
        amountOwedCents: 0,
        owedPending: true,
        ...overrides,
      },
    });
    return { trip, registration };
  }

  it("keeps a waiting registration waiting with the amount blank, and an amount typed ends the wait", async () => {
    const { registration } = await oneRegistration();
    assert.deepEqual(await editRegistration(actions, admin, registration, { payingCount: 3 }), {});
    let after = await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: registration.id } });
    assert.equal(after.payingCount, 3);
    assert.equal(after.owedPending, true);
    assert.equal(after.amountOwedCents, 0);

    assert.deepEqual(await editRegistration(actions, admin, after, { amountOwed: "75.50" }), {});
    after = await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: registration.id } });
    assert.equal(after.owedPending, false);
    assert.equal(after.amountOwedCents, 7550);
    const entry = await db.prisma.auditLog.findFirstOrThrow({
      where: { action: "tripRegistration.update", entityId: registration.id },
      orderBy: { createdAt: "desc" },
    });
    assert.deepEqual(
      (entry.details as { label: string; from: string; to: string }[]).find((d) => d.label === "Amount owed"),
      { label: "Amount owed", from: "TBD", to: "$75.50" },
    );
  });

  it("applies the shared bounds, but lets a larger group added before them keep its size", async () => {
    const { registration } = await oneRegistration({ payingCount: 60, owedPending: false, amountOwedCents: 240000 });
    const current = () => db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: registration.id } });
    // Renaming it, counts unchanged: fine.
    assert.deepEqual(
      await editRegistration(actions, admin, registration, { familyName: "Renamed", amountOwed: "2400.00" }),
      {},
    );
    // Growing it further, or a new oversize count: refused.
    assert.match((await editRegistration(actions, admin, await current(), { payingCount: 61, amountOwed: "2440" })).error ?? "", /more than 50/);
    // Shrinking it under the ceiling: fine.
    assert.deepEqual(await editRegistration(actions, admin, await current(), { payingCount: 45, amountOwed: "1800" }), {});

    for (const [changes, message] of [
      [{ amountOwed: "abc" }, /valid amount owed/],
      [{ amountOwed: "-5" }, /valid amount owed/],
      [{ amountOwed: "1000000.01" }, /valid amount owed/],
      [{ contactEmail: "x" }, /valid email/],
      [{ guestOfName: "" }, /required/],
    ] as [Record<string, string>, RegExp][]) {
      const result = await editRegistration(actions, admin, await current(), { amountOwed: "1800", ...changes });
      assert.match(result.error ?? "", message, JSON.stringify(changes));
    }
    const after = await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: registration.id } });
    assert.equal(after.familyName, "Renamed");
    assert.equal(after.payingCount, 45);
    assert.equal(after.amountOwedCents, 180000);
  });

  it("says so when the registration was removed in the meantime", async () => {
    const { registration } = await oneRegistration();
    await db.prisma.tripRegistration.delete({ where: { id: registration.id } });
    assert.match((await editRegistration(actions, admin, registration, { payingCount: 3 })).error ?? "", /removed/);
  });

  it("is Admin-only", async () => {
    const { registration } = await oneRegistration();
    const junior = await createUser(db.prisma, "JUNIOR_ADMIN");
    assert.equal((await settle(editRegistration(actions, junior, registration, { payingCount: 9 }))).ok, false);
    assert.equal((await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: registration.id } })).payingCount, 2);
  });
});
