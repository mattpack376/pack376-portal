/*
 * Price posting vs. registration (review finding F4), against a real
 * Postgres. A registration used to read the trip — and decide "TBD, owes $0
 * for now" — before taking any lock, so one that read TBD could commit after
 * the admin posted the price and the waiting registrations were charged,
 * leaving it pending at $0 for good. Now the public form, the admin forms,
 * price posting and settling all take the TripPage row lock first and read
 * the trip's terms under it.
 *
 * The deterministic tests hold a lock on a second connection (db.pool) so an
 * action is provably parked at a point where it must wait, then release it
 * and check the final state is one a serial order could produce. Run against
 * the old actions (checked by temporarily restoring them), the race tests
 * fail on the database state — a registration left pending at $0, an
 * attendee change overwritten, a family registered after the page closed,
 * the price "posted" twice — or time out because the old action never waits
 * for the lock at all. The exception is "one added first", which the old code
 * also got right: a family that really commits before the posting was always
 * charged by it. The stress tests run real actions together and check the
 * invariants hold whatever the interleaving.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { openTransaction, waitForLockWait, withTestDatabase } from "../support/db";
import { form, resetTestState, runAs, settle, testState, type SessionUser } from "../support/context";
import {
  addByHand,
  assertAllCharged,
  createUser,
  editRegistration,
  emailLockKey,
  familyForm,
  freshTrip,
  loadTripActions,
  LOCK_EMAIL,
  LOCK_REGISTRATION,
  LOCK_TRIP,
  register,
  registrationsOf,
  savePricing,
  waitForWaiters,
  type TripActions,
} from "./tripHelpers";

const db = withTestDatabase("trip_pricing");
let actions: TripActions;
let admin: SessionUser;

before(async () => {
  await db.ready;
  actions = await loadTripActions();
  admin = await createUser(db.prisma, "ADMIN");
});

beforeEach(() => resetTestState());

/** Pricing audit entries for a trip, oldest first. */
async function pricingAudits(tripPageId: string) {
  return db.prisma.auditLog.findMany({
    where: { action: "trip.updatePricing", entityId: tripPageId },
    orderBy: { createdAt: "asc" },
  });
}

/** The "<family> owes" lines a pricing audit entry lists — one per registration it charged. */
function chargedFamilies(entry: { details: unknown }) {
  const details = (entry.details ?? []) as { label: string; from: string; to: string }[];
  return details.filter((d) => d.label.endsWith(" owes")).map((d) => d.label.slice(0, -" owes".length));
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

describe("a registration that read TBD while the price was being posted", () => {
  it("is charged the posted price, never left pending at $0", async (t) => {
    const trip = await freshTrip(db.prisma);
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    // A price posting caught mid-transaction: the row is locked and already
    // says $40, uncommitted.
    await holder.query(LOCK_TRIP, [trip.id]);
    await holder.query(`UPDATE "TripPage" SET "priceTbd" = false, "regularPriceCents" = 4000 WHERE "id" = $1`, [trip.id]);

    const submitting = register(actions, familyForm(trip.id, { payingCount: 2 }));
    await waitForLockWait(db.pool);
    // Everything the submission could have read until now still said TBD.
    // (The old code read it here, decided "pending, $0", and its insert then
    // waited on this lock only for the foreign-key check.)
    assert.equal((await db.prisma.tripPage.findUniqueOrThrow({ where: { id: trip.id } })).priceTbd, true);
    await holder.commit();

    const result = await submitting;
    assert.equal(result.error, undefined);
    assert.equal(result.success, true);
    const [row] = await registrationsOf(db.prisma, trip.id);
    assert.equal(row.owedPending, false);
    assert.equal(row.amountOwedCents, 8000);
  });

  it("that got the lock first is charged by the posting queued behind it", async (t) => {
    const trip = await freshTrip(db.prisma);
    const values = familyForm(trip.id, { payingCount: 2 });
    // Park the registration *inside* its transaction: it takes the trip lock,
    // reads TBD, then waits for its per-address lock, which this holds.
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(LOCK_EMAIL, [emailLockKey(trip.id, String(values.contactEmail))]);

    const submitting = register(actions, values);
    await waitForWaiters(db.pool, 1);
    const posting = savePricing(actions, admin, trip.id, { regularPrice: "40" });
    // The posting has to wait for the registration's trip lock. (In the old
    // code it didn't wait for anything, finished with nothing to charge, and
    // this times out.)
    await waitForWaiters(db.pool, 2);
    await holder.rollback();

    const [registered, posted] = await Promise.all([submitting, posting]);
    assert.equal(registered.success, true);
    assert.deepEqual(posted, {});
    await assertAllCharged(db.prisma, trip.id, 4000);
    const [audit] = await pricingAudits(trip.id);
    assert.deepEqual(chargedFamilies(audit), [values.familyName], "the posting charged it, and says so");
  });

  it("that queued behind the posting reads the posted price", async (t) => {
    const trip = await freshTrip(db.prisma);
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(LOCK_TRIP, [trip.id]);

    const posting = savePricing(actions, admin, trip.id, { regularPrice: "40" });
    await waitForWaiters(db.pool, 1);
    const submitting = register(actions, familyForm(trip.id, { payingCount: 3 }));
    await waitForWaiters(db.pool, 2);
    await holder.rollback();

    const [posted, registered] = await Promise.all([posting, submitting]);
    assert.deepEqual(posted, {});
    assert.equal(registered.success, true);
    await assertAllCharged(db.prisma, trip.id, 4000);
    assert.equal((await registrationsOf(db.prisma, trip.id))[0].amountOwedCents, 12000);
  });
});

describe("admin-added registrations while the price is posted", () => {
  it("one added first is charged by the posting", async (t) => {
    const trip = await freshTrip(db.prisma);
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(LOCK_TRIP, [trip.id]);

    const values = familyForm(trip.id, { payingCount: 3 });
    const adding = addByHand(actions, admin, values);
    await waitForWaiters(db.pool, 1);
    const posting = savePricing(actions, admin, trip.id, { regularPrice: "40" });
    await waitForWaiters(db.pool, 2);
    await holder.rollback();

    assert.deepEqual(await Promise.all([adding, posting]), [{}, {}]);
    await assertAllCharged(db.prisma, trip.id, 4000);
    const [row] = await registrationsOf(db.prisma, trip.id);
    const created = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "tripRegistration.create", entityId: row.id } });
    const owed = (created.details as { label: string; to: string }[]).find((d) => d.label === "Amount owed");
    assert.equal(owed?.to, "TBD (price not released)", "added while the price was still TBD");
    assert.deepEqual(chargedFamilies((await pricingAudits(trip.id))[0]), [values.familyName]);
  });

  it("one added after the posting is priced when it's added", async (t) => {
    const trip = await freshTrip(db.prisma);
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(LOCK_TRIP, [trip.id]);

    const posting = savePricing(actions, admin, trip.id, { regularPrice: "40" });
    await waitForWaiters(db.pool, 1);
    const adding = addByHand(actions, admin, familyForm(trip.id, { payingCount: 3 }));
    await waitForWaiters(db.pool, 2);
    await holder.rollback();

    assert.deepEqual(await Promise.all([posting, adding]), [{}, {}]);
    await assertAllCharged(db.prisma, trip.id, 4000);
    assert.deepEqual(chargedFamilies((await pricingAudits(trip.id))[0]), [], "nothing was waiting when it posted");
  });

  it("stress: posting amid several addresses and admin additions never strands a registration", async () => {
    for (let round = 0; round < 20; round++) {
      const trip = await freshTrip(db.prisma);
      // One registration already waiting before the race starts.
      const early = await register(actions, familyForm(trip.id, { payingCount: 1 }));
      assert.equal(early.success, true);

      const work = shuffled([
        () => savePricing(actions, admin, trip.id, { regularPrice: "40" }),
        () => register(actions, familyForm(trip.id, { payingCount: 1 })),
        () => register(actions, familyForm(trip.id, { payingCount: 2 })),
        () => register(actions, familyForm(trip.id, { payingCount: 3, affiliation: "TROOP" })),
        () => addByHand(actions, admin, familyForm(trip.id, { payingCount: 4 })),
        () => addByHand(actions, admin, familyForm(trip.id, { payingCount: 5 })),
      ]);
      const results = await Promise.all(work.map((start) => start()));
      for (const result of results) assert.equal(result.error, undefined, `round ${round}`);

      assert.equal((await registrationsOf(db.prisma, trip.id)).length, 6, `round ${round}`);
      await assertAllCharged(db.prisma, trip.id, 4000);
      // Whatever the posting charged, it charged once, and the early one was among them.
      const charged = chargedFamilies((await pricingAudits(trip.id))[0]);
      assert.equal(new Set(charged).size, charged.length);
      assert.ok(charged.length >= 1, `round ${round}: the registration waiting beforehand was charged`);
    }
  });
});

describe("price posting vs. an admin editing a waiting registration", () => {
  async function waitingRegistration() {
    const trip = await freshTrip(db.prisma);
    assert.equal((await register(actions, familyForm(trip.id, { payingCount: 2 }))).success, true);
    const [registration] = await registrationsOf(db.prisma, trip.id);
    assert.equal(registration.owedPending, true);
    return { trip, registration };
  }

  it("an attendee change saved first is what the posting charges for", async (t) => {
    const { trip, registration } = await waitingRegistration();
    // Park the edit at its write: it holds the trip lock and has read the
    // registration as waiting.
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(LOCK_REGISTRATION, [registration.id]);

    const editing = editRegistration(actions, admin, registration, { payingCount: 3 });
    await waitForWaiters(db.pool, 1);
    // (In the old code the posting read the 2 attendees, waited here on the
    // same row, and then overwrote the edit's count with 2 × $40.)
    const posting = savePricing(actions, admin, trip.id, { regularPrice: "40" });
    await waitForWaiters(db.pool, 2);
    await holder.rollback();

    assert.deepEqual(await Promise.all([editing, posting]), [{}, {}]);
    const after = await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: registration.id } });
    assert.equal(after.payingCount, 3);
    assert.equal(after.amountOwedCents, 12000);
    assert.equal(after.owedPending, false);
  });

  it("an edit from a form loaded before the posting is turned down, not saved over the new amount", async (t) => {
    const { trip, registration } = await waitingRegistration();
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(LOCK_TRIP, [trip.id]);

    const posting = savePricing(actions, admin, trip.id, { regularPrice: "40" });
    await waitForWaiters(db.pool, 1);
    // Still the blank "waiting for the price" amount the page showed.
    const editing = editRegistration(actions, admin, registration, { payingCount: 3, familyName: "Renamed" });
    await waitForWaiters(db.pool, 2);
    await holder.rollback();

    const [posted, edited] = await Promise.all([posting, editing]);
    assert.deepEqual(posted, {});
    assert.match(edited.error ?? "", /reload the page/i);
    assert.match(edited.error ?? "", /set to \$80\.00 after this page loaded/);
    assert.equal(edited.stale, true);
    const after = await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: registration.id } });
    assert.equal(after.familyName, registration.familyName, "nothing from the refused edit was saved");
    assert.equal(after.payingCount, 2);
    assert.equal(after.amountOwedCents, 8000);
    assert.equal(await db.prisma.auditLog.count({ where: { action: "tripRegistration.update", entityId: registration.id } }), 0);

    // Reloaded, the form now carries the amount, and the change goes through.
    assert.deepEqual(await editRegistration(actions, admin, registration, { payingCount: 3, amountOwed: "120.00" }), {});
    const fixed = await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: registration.id } });
    assert.equal(fixed.amountOwedCents, 12000);
  });

  it("stress: the result always matches one order or the other", async () => {
    for (let round = 0; round < 20; round++) {
      const { trip, registration } = await waitingRegistration();
      let edited: { error?: string } = {};
      let posted: { error?: string } = {};
      await Promise.all(
        shuffled([
          async () => {
            edited = await editRegistration(actions, admin, registration, { payingCount: 3 });
          },
          async () => {
            posted = await savePricing(actions, admin, trip.id, { regularPrice: "40" });
          },
        ]).map((start) => start()),
      );
      assert.deepEqual(posted, {}, `round ${round}`);
      const after = await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: registration.id } });
      assert.equal(after.owedPending, false, `round ${round}`);
      assert.equal(after.amountOwedCents, after.payingCount * 4000, `round ${round}`);
      // Edit first: it's what got charged. Posting first: the stale edit is refused.
      if (edited.error) {
        assert.match(edited.error, /reload the page/i);
        assert.equal(after.payingCount, 2, `round ${round}`);
      } else {
        assert.equal(after.payingCount, 3, `round ${round}`);
      }
    }
  });
});

describe("closing registration while a family submits", () => {
  it("an unpublish that got there first turns the submission away", async (t) => {
    const trip = await freshTrip(db.prisma);
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(LOCK_TRIP, [trip.id]);

    const unpublishing = runAs(admin, () =>
      actions.page.toggleTripPublishedAction(form({ id: trip.id, published: "true" })),
    );
    await waitForWaiters(db.pool, 1);
    // (The old code had already read "published" here and only waited for
    // the foreign-key check, which an unpublish doesn't block.)
    const submitting = register(actions, familyForm(trip.id));
    await waitForWaiters(db.pool, 2);
    await holder.rollback();

    const [, result] = await Promise.all([unpublishing, submitting]);
    assert.match(result.error ?? "", /closed/);
    assert.equal((await registrationsOf(db.prisma, trip.id)).length, 0);
    assert.equal((await db.prisma.tripPage.findUniqueOrThrow({ where: { id: trip.id } })).published, false);
  });

  it("a submission that got there first is kept, and the page still comes down", async (t) => {
    const trip = await freshTrip(db.prisma);
    const values = familyForm(trip.id);
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(LOCK_EMAIL, [emailLockKey(trip.id, String(values.contactEmail))]);

    const submitting = register(actions, values);
    await waitForWaiters(db.pool, 1);
    const unpublishing = runAs(admin, () =>
      actions.page.toggleTripPublishedAction(form({ id: trip.id, published: "true" })),
    );
    await waitForWaiters(db.pool, 2);
    await holder.rollback();

    const [result] = await Promise.all([submitting, unpublishing]);
    assert.equal(result.success, true);
    assert.equal((await registrationsOf(db.prisma, trip.id)).length, 1);
    assert.equal((await db.prisma.tripPage.findUniqueOrThrow({ where: { id: trip.id } })).published, false);
  });

  it("a deadline moved into the past while a submission waits closes it", async (t) => {
    const trip = await freshTrip(db.prisma);
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(LOCK_TRIP, [trip.id]);

    const closing = savePricing(actions, admin, trip.id, { regularPrice: "0", priceTbd: true, rsvpDeadline: "2020-01-01" });
    await waitForWaiters(db.pool, 1);
    const submitting = register(actions, familyForm(trip.id));
    await waitForWaiters(db.pool, 2);
    await holder.rollback();

    const [closed, result] = await Promise.all([closing, submitting]);
    assert.deepEqual(closed, {});
    assert.match(result.error ?? "", /closed/);
    assert.equal((await registrationsOf(db.prisma, trip.id)).length, 0);
  });

  it("stress: a registration either commits before the unpublish or is refused", async () => {
    for (let round = 0; round < 20; round++) {
      const trip = await freshTrip(db.prisma);
      const results = await Promise.all(
        shuffled<() => Promise<unknown>>([
          () => runAs(admin, () => actions.page.toggleTripPublishedAction(form({ id: trip.id, published: "true" }))),
          () => register(actions, familyForm(trip.id, { familyName: "Racer" })),
        ]).map((start) => start()),
      );
      const result = results.find((r) => typeof r === "object" && r !== null && ("success" in r || "error" in r)) as {
        success?: boolean;
        error?: string;
      };
      const rows = await registrationsOf(db.prisma, trip.id);
      assert.equal(rows.length, result.success ? 1 : 0, `round ${round}`);
      if (!result.success) assert.match(result.error ?? "", /closed/);
      assert.equal((await db.prisma.tripPage.findUniqueOrThrow({ where: { id: trip.id } })).published, false);
    }
  });
});

describe("posting the price again, and retrying", () => {
  async function tripWithWaiting(count: number) {
    const trip = await freshTrip(db.prisma);
    for (let i = 0; i < count; i++) {
      assert.equal((await register(actions, familyForm(trip.id, { payingCount: i + 1 }))).success, true);
    }
    return trip;
  }

  it("a second save of the same form charges nobody twice", async () => {
    const trip = await tripWithWaiting(2);
    assert.deepEqual(await savePricing(actions, admin, trip.id, { regularPrice: "40" }), {});
    const charged = (await registrationsOf(db.prisma, trip.id)).map((r) => r.amountOwedCents);
    assert.deepEqual(await savePricing(actions, admin, trip.id, { regularPrice: "40" }), {});

    assert.deepEqual((await registrationsOf(db.prisma, trip.id)).map((r) => r.amountOwedCents), charged);
    const [posted, again] = await pricingAudits(trip.id);
    assert.match(posted.summary, /^Posted the price/);
    assert.equal(chargedFamilies(posted).length, 2);
    assert.match(again.summary, /^Changed the pricing/);
    assert.deepEqual(chargedFamilies(again), []);
  });

  it("two postings at once charge each registration exactly once", async () => {
    for (let round = 0; round < 10; round++) {
      const trip = await tripWithWaiting(3);
      const results = await Promise.all([
        savePricing(actions, admin, trip.id, { regularPrice: "40" }),
        savePricing(actions, admin, trip.id, { regularPrice: "40" }),
      ]);
      assert.deepEqual(results, [{}, {}]);
      await assertAllCharged(db.prisma, trip.id, 4000);
      const audits = await pricingAudits(trip.id);
      assert.equal(audits.filter((a) => a.summary.startsWith("Posted the price")).length, 1, `round ${round}`);
      assert.equal(audits.flatMap(chargedFamilies).length, 3, `round ${round}`);
    }
  });

  it("posting $0 is refused with nothing changed, and the retry with a price charges everyone", async () => {
    const trip = await tripWithWaiting(2);
    const refused = await savePricing(actions, admin, trip.id, { regularPrice: "0" });
    assert.match(refused.error ?? "", /still \$0\.00/);
    assert.equal(refused.stale, undefined, "a refusal about what was typed keeps the admin's entries");
    assert.equal((await db.prisma.tripPage.findUniqueOrThrow({ where: { id: trip.id } })).priceTbd, true);
    assert.ok((await registrationsOf(db.prisma, trip.id)).every((r) => r.owedPending && r.amountOwedCents === 0));
    assert.equal((await pricingAudits(trip.id)).length, 0);

    assert.deepEqual(await savePricing(actions, admin, trip.id, { regularPrice: "40" }), {});
    await assertAllCharged(db.prisma, trip.id, 4000);
  });

  it("a total too large to store refuses the whole posting", async () => {
    const trip = await tripWithWaiting(2); // 1 and 2 paying attendees
    const refused = await savePricing(actions, admin, trip.id, { regularPrice: "1000000" });
    assert.match(refused.error ?? "", /more than \$1,000,000\.00/);
    const after = await db.prisma.tripPage.findUniqueOrThrow({ where: { id: trip.id } });
    assert.equal(after.priceTbd, true, "the price wasn't posted either");
    assert.equal(after.regularPriceCents, 0);
    assert.ok((await registrationsOf(db.prisma, trip.id)).every((r) => r.owedPending));
    assert.equal((await pricingAudits(trip.id)).length, 0);
  });

  it("changing a posted price leaves what families were already charged alone", async () => {
    const trip = await tripWithWaiting(1);
    assert.deepEqual(await savePricing(actions, admin, trip.id, { regularPrice: "40" }), {});
    assert.deepEqual(await savePricing(actions, admin, trip.id, { regularPrice: "50" }), {});
    const [first] = await registrationsOf(db.prisma, trip.id);
    assert.equal(first.amountOwedCents, 4000, "frozen at what it was charged");

    assert.equal((await register(actions, familyForm(trip.id, { payingCount: 1 }))).success, true);
    const [, second] = await registrationsOf(db.prisma, trip.id);
    assert.equal(second.amountOwedCents, 5000);
    assert.equal(second.owedPending, false);
  });

  it("back to TBD and posted again: only the new waiting registrations are charged, at the new price", async () => {
    const trip = await tripWithWaiting(1);
    assert.deepEqual(await savePricing(actions, admin, trip.id, { regularPrice: "40" }), {});
    assert.deepEqual(await savePricing(actions, admin, trip.id, { regularPrice: "40", priceTbd: true }), {});
    assert.equal((await register(actions, familyForm(trip.id, { payingCount: 2 }))).success, true);
    const [, waiting] = await registrationsOf(db.prisma, trip.id);
    assert.equal(waiting.owedPending, true);

    assert.deepEqual(await savePricing(actions, admin, trip.id, { regularPrice: "45" }), {});
    const [first, second] = await registrationsOf(db.prisma, trip.id);
    assert.equal(first.amountOwedCents, 4000);
    assert.equal(second.amountOwedCents, 9000);
    assert.equal(second.owedPending, false);
  });

  it("a free event is priced at $0, not left waiting; an event without the toggle can't go TBD", async () => {
    const trip = await freshTrip(db.prisma, { slug: "camp-conron", priceTbd: false, regularPriceCents: 0 });
    assert.deepEqual(await savePricing(actions, admin, trip.id, { regularPrice: "0", priceTbd: true }), {});
    assert.equal((await db.prisma.tripPage.findUniqueOrThrow({ where: { id: trip.id } })).priceTbd, false);

    assert.equal((await register(actions, familyForm(trip.id, { payingCount: 2 }))).success, true);
    const [row] = await registrationsOf(db.prisma, trip.id);
    assert.equal(row.owedPending, false);
    assert.equal(row.amountOwedCents, 0);
  });

  it("refuses non-admins and malformed input without changing anything", async () => {
    const trip = await tripWithWaiting(1);
    const junior = await createUser(db.prisma, "JUNIOR_ADMIN");
    const denied = await settle(savePricing(actions, junior, trip.id, { regularPrice: "40" }));
    assert.equal(denied.ok, false);

    for (const values of [
      { regularPrice: "-5" },
      { regularPrice: "1e3" },
      { regularPrice: "40", earlyBirdPrice: "abc" },
      { regularPrice: "40", rsvpDeadline: "2026-02-31" },
      { regularPrice: "40", freeAgeAndUnder: "1e3" },
    ]) {
      const result = await savePricing(actions, admin, trip.id, values);
      assert.ok(result.error, JSON.stringify(values));
    }
    assert.equal((await db.prisma.tripPage.findUniqueOrThrow({ where: { id: trip.id } })).priceTbd, true);
    assert.equal((await pricingAudits(trip.id)).length, 0);
  });
});

describe("registrations already left waiting on a priced trip", () => {
  /** A priced trip with one registration a race stranded (pending, $0) and one charged at signup. */
  async function strandedTrip() {
    const trip = await freshTrip(db.prisma, { priceTbd: false, regularPriceCents: 4000 });
    const row = (familyName: string) => ({
      tripPageId: trip.id,
      familyName,
      contactEmail: `${familyName.toLowerCase().replace(/\W+/g, "-")}@example.test`,
      contactPhone: "(212)555-0100",
      guestOfName: "Timmy Test",
    });
    const stranded = await db.prisma.tripRegistration.create({
      data: { ...row("The Stranded Family"), affiliation: "PACK", payingCount: 3, freeCount: 0, amountOwedCents: 0, owedPending: true },
    });
    // Charged $35/person at signup (an early-bird rate since ended).
    const charged = await db.prisma.tripRegistration.create({
      data: { ...row("The Early Family"), affiliation: "TROOP", payingCount: 2, freeCount: 0, amountOwedCents: 7000, owedPending: false },
    });
    return { trip, stranded, charged };
  }

  /** The banner's Charge button: the price it showed, and the families and paying counts it listed. */
  const settleAs = (
    user: SessionUser,
    tripPageId: string,
    pricePerPersonCents: number | string,
    listed: { id: string; payingCount: number }[] | string[],
  ) =>
    runAs(user, () =>
      actions.page.settleWaitingTripRegistrationsAction(
        form({
          id: tripPageId,
          pricePerPersonCents: String(pricePerPersonCents),
          waiting: listed.map((reg) => (typeof reg === "string" ? reg : `${reg.id}:${reg.payingCount}`)),
        }),
      ),
    );

  it("are charged at the posted price from the admin page, one audit entry per family", async () => {
    const { trip, stranded, charged } = await strandedTrip();
    assert.deepEqual(await settleAs(admin, trip.id, 4000, [stranded]), {});

    const after = await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: stranded.id } });
    assert.equal(after.owedPending, false);
    assert.equal(after.amountOwedCents, 12000);
    const untouched = await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: charged.id } });
    assert.equal(untouched.amountOwedCents, 7000, "an amount set at signup is never repriced");

    const settledEntries = () =>
      db.prisma.auditLog.findMany({
        where: { action: "tripRegistration.settlePrice", entityId: { in: [stranded.id, charged.id] } },
      });
    const entries = await settledEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].entityId, stranded.id);
    assert.match(entries[0].summary, /3 × \$40\.00 = \$120\.00/);

    // Nothing left to do the second time.
    assert.deepEqual(await settleAs(admin, trip.id, 4000, [stranded]), {});
    assert.equal((await settledEntries()).length, 1);
  });

  it("are not charged if the price changed after the page showed it", async () => {
    const { trip, stranded } = await strandedTrip();
    const result = await settleAs(admin, trip.id, 3500, [stranded]);
    assert.match(result.error ?? "", /now \$40\.00\/person/);
    assert.equal(result.stale, true, "the form shows the refreshed page, not the old entries");
    assert.ok(testState.revalidated.includes("/portal/admin/cyclones"), "the page is refreshed to show the current price");
    const after = await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: stranded.id } });
    assert.equal(after.owedPending, true);
    assert.equal(await db.prisma.auditLog.count({ where: { action: "tripRegistration.settlePrice", entityId: stranded.id } }), 0);
  });

  it("keep waiting if the price went back to TBD", async () => {
    const { trip, stranded } = await strandedTrip();
    await db.prisma.tripPage.update({ where: { id: trip.id }, data: { priceTbd: true } });
    assert.match((await settleAs(admin, trip.id, 4000, [stranded])).error ?? "", /TBD/);
    assert.equal((await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: stranded.id } })).owedPending, true);
  });

  it("can only be charged by an Admin", async () => {
    const { trip, stranded } = await strandedTrip();
    for (const role of ["JUNIOR_ADMIN", "TRIP_VIEWER", "PARENT"] as const) {
      const user = await createUser(db.prisma, role);
      assert.equal((await settle(settleAs(user, trip.id, 4000, [stranded]))).ok, false, role);
    }
    assert.equal((await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: stranded.id } })).owedPending, true);
  });

  it("are also charged by the next ordinary pricing save — no second save needed", async () => {
    const { trip, stranded, charged } = await strandedTrip();
    assert.deepEqual(await savePricing(actions, admin, trip.id, { regularPrice: "40" }), {});
    assert.equal((await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: stranded.id } })).amountOwedCents, 12000);
    assert.equal((await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: charged.id } })).amountOwedCents, 7000);
    const [audit] = await pricingAudits(trip.id);
    assert.match(audit.summary, /still waiting for a price/);
    assert.deepEqual(chargedFamilies(audit), [stranded.familyName]);
  });

  it("is charged attendees × the posted price when edited with the amount left blank", async () => {
    const { stranded } = await strandedTrip();
    // The form quotes the price it will charge at (chargePricePerPersonCents).
    assert.deepEqual(await editRegistration(actions, admin, stranded, { payingCount: 4, chargePricePerPersonCents: 4000 }), {});
    const after = await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: stranded.id } });
    assert.equal(after.owedPending, false);
    assert.equal(after.amountOwedCents, 16000);
  });

  it("is not charged from an edit form that quoted another price, or none", async () => {
    const { trip, stranded } = await strandedTrip();
    // The form was loaded during an early-bird rate that has since ended: it
    // said a blank amount would be charged at $35, and today it's $40.
    await db.prisma.tripPage.update({
      where: { id: trip.id },
      data: { earlyBirdPriceCents: 3500, earlyBirdDeadline: new Date("2020-01-01T00:00:00Z") },
    });
    const quotedOld = await editRegistration(actions, admin, stranded, { payingCount: 4, chargePricePerPersonCents: 3500 });
    assert.match(quotedOld.error ?? "", /now \$40\.00\/person, not \$35\.00/);
    assert.equal(quotedOld.stale, true);
    // A form that quoted no price was loaded while the price was TBD.
    const quotedNone = await editRegistration(actions, admin, stranded, { payingCount: 4 });
    assert.match(quotedNone.error ?? "", /posted after this page loaded/);

    let after = await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: stranded.id } });
    assert.equal(after.owedPending, true, "still waiting — nothing from the refused edits was saved");
    assert.equal(after.payingCount, 3);
    assert.equal(await db.prisma.auditLog.count({ where: { action: "tripRegistration.update", entityId: stranded.id } }), 0);

    // The refreshed form quotes $40, and the edit goes through at that.
    assert.deepEqual(await editRegistration(actions, admin, stranded, { payingCount: 4, chargePricePerPersonCents: 4000 }), {});
    after = await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: stranded.id } });
    assert.equal(after.amountOwedCents, 16000);
  });

  it("are not charged when a family that wasn't listed is waiting too", async () => {
    const { trip, stranded } = await strandedTrip();
    const unlisted = await db.prisma.tripRegistration.create({
      data: {
        tripPageId: trip.id,
        familyName: "The Unlisted Family",
        contactEmail: "unlisted@example.test",
        guestOfName: "Timmy Test",
        affiliation: "PACK",
        payingCount: 5,
        freeCount: 0,
        amountOwedCents: 0,
        owedPending: true,
      },
    });
    const result = await settleAs(admin, trip.id, 4000, [stranded]);
    assert.match(result.error ?? "", /changed after this page loaded/);
    assert.equal(result.stale, true);
    for (const id of [stranded.id, unlisted.id]) {
      assert.equal((await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id } })).owedPending, true);
    }
    assert.equal(
      await db.prisma.auditLog.count({ where: { action: "tripRegistration.settlePrice", entityId: { in: [stranded.id, unlisted.id] } } }),
      0,
    );

    // The refreshed banner lists both, and that goes through.
    assert.deepEqual(await settleAs(admin, trip.id, 4000, [stranded, unlisted]), {});
    assert.equal((await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: unlisted.id } })).amountOwedCents, 20000);
  });

  it("are not charged when a paying count changed while the Charge click waited", async (t) => {
    const { trip, stranded } = await strandedTrip();
    // An edit in another tab holds the trip and changes the count from the
    // 3 the banner listed to 4; the click queues behind it. (The old action
    // checked only the price, and charged 4 × $40 for a family the admin
    // confirmed at 3 × $40.)
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(LOCK_TRIP, [trip.id]);
    await holder.query(`UPDATE "TripRegistration" SET "payingCount" = 4 WHERE "id" = $1`, [stranded.id]);
    const charging = settleAs(admin, trip.id, 4000, [stranded]);
    await waitForLockWait(db.pool);
    await holder.commit();

    assert.match((await charging).error ?? "", /changed after this page loaded/);
    const after = await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: stranded.id } });
    assert.equal(after.owedPending, true);
    assert.equal(after.amountOwedCents, 0);
  });

  it("a click queued behind a change that keeps the list as shown charges what was shown", async (t) => {
    const { trip, stranded } = await strandedTrip();
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(LOCK_TRIP, [trip.id]);
    await holder.query(`UPDATE "TripRegistration" SET "familyName" = 'The Renamed Family' WHERE "id" = $1`, [stranded.id]);
    const charging = settleAs(admin, trip.id, 4000, [stranded]);
    await waitForLockWait(db.pool);
    await holder.commit();

    assert.deepEqual(await charging, {});
    const after = await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: stranded.id } });
    assert.equal(after.owedPending, false);
    assert.equal(after.amountOwedCents, 12000);
  });

  it("one charged by a pricing save in the meantime isn't charged again", async () => {
    const { trip, stranded } = await strandedTrip();
    assert.deepEqual(await savePricing(actions, admin, trip.id, { regularPrice: "40" }), {});
    // The banner was still on screen in another tab; its click finds nothing left to do.
    assert.deepEqual(await settleAs(admin, trip.id, 4000, [stranded]), {});
    assert.equal((await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: stranded.id } })).amountOwedCents, 12000);
    assert.equal(await db.prisma.auditLog.count({ where: { action: "tripRegistration.settlePrice", entityId: stranded.id } }), 0);
    assert.deepEqual((await pricingAudits(trip.id)).flatMap(chargedFamilies), [stranded.familyName]);
  });

  it("refuses a malformed list without charging anything", async () => {
    const { trip, stranded } = await strandedTrip();
    for (const listed of [[`${stranded.id}`], [`${stranded.id}:x`], [`${stranded.id}:3`, `${stranded.id}:3`], ["a b:3"]]) {
      assert.match((await settleAs(admin, trip.id, 4000, listed)).error ?? "", /Reload the page/, JSON.stringify(listed));
    }
    assert.equal((await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: stranded.id } })).owedPending, true);
  });

  it("settling and a new registration at the same time leave nothing waiting", async () => {
    for (let round = 0; round < 10; round++) {
      const { trip, stranded } = await strandedTrip();
      const results = await Promise.all(
        shuffled<() => Promise<{ error?: string }>>([
          () => settleAs(admin, trip.id, 4000, [stranded]),
          () => register(actions, familyForm(trip.id, { payingCount: 1 })),
          () => savePricing(actions, admin, trip.id, { regularPrice: "40" }),
        ]).map((start) => start()),
      );
      for (const result of results) assert.equal(result.error, undefined, `round ${round}`);
      const rows = await registrationsOf(db.prisma, trip.id);
      assert.ok(rows.every((r) => !r.owedPending), `round ${round}`);
      // The stranded one charged exactly once, whichever action got it.
      const settledAudits = await db.prisma.auditLog.findMany({
        where: { OR: [{ action: "tripRegistration.settlePrice" }, { action: "trip.updatePricing", entityId: trip.id }] },
      });
      const timesCharged =
        settledAudits.filter((a) => a.action === "tripRegistration.settlePrice" && rows.some((r) => r.id === a.entityId)).length +
        settledAudits.filter((a) => a.action === "trip.updatePricing").flatMap(chargedFamilies).length;
      assert.equal(timesCharged, 1, `round ${round}`);
    }
  });
});
