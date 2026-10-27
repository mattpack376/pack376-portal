/*
 * F7: a family (or leader) signing up their own guest group. Bounds on every
 * field, who may use it, the per-login limit per event, and one group per
 * submission key — including two copies of one request arriving together.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, describe, it } from "node:test";
import { openTransaction, waitForLockWait, withTestDatabase } from "../support/db";
import { asAnonymous, form, resetTestState, runAs, settle, testState, type SessionUser } from "../support/context";
import { packFixtures, waitForLockWaiters } from "./fixtures/pack";

const db = withTestDatabase("guest_self_registration");
let events: typeof import("@/lib/actions/events");
let fx: ReturnType<typeof packFixtures>;

before(async () => {
  await db.ready;
  events = await import("@/lib/actions/events");
  fx = packFixtures(db.prisma);
});

beforeEach(() => resetTestState());

const STALE_FORM = /already used or is out of date/;
const NOT_OPEN = /isn't open for self-registration/;

/** A parent of a Tiger and a Wolf (the Wolf is the "oldest"). */
async function family() {
  const tigers = await fx.den("TIGER");
  const wolves = await fx.den("WOLF");
  const younger = await fx.scout(tigers.id);
  const older = await fx.scout(wolves.id);
  const parent = await fx.user("PARENT", { scoutIds: [younger.id, older.id] });
  return { parent, younger, older };
}

type Fields = Record<string, string | number | undefined>;

function signUp(user: SessionUser, fields: Fields) {
  return runAs(user, () =>
    events.registerMyGuestGroupForEventAction(form({ submissionKey: randomUUID(), familyName: "Guests", ...fields })),
  );
}

async function writeCounts() {
  const [groups, audits] = await Promise.all([db.prisma.eventGuestGroup.count(), db.prisma.auditLog.count()]);
  return { groups, audits };
}

/** Runs each submission and asserts every one was refused with `message` and nothing was written. */
async function assertRefused(user: SessionUser, submissions: Fields[], message: RegExp) {
  const beforeCounts = await writeCounts();
  for (const fields of submissions) {
    const result = await signUp(user, fields);
    assert.match(result.error ?? "(no error)", message, `refused: ${JSON.stringify(fields).slice(0, 120)}`);
  }
  assert.deepEqual(await writeCounts(), beforeCounts, "nothing written");
}

describe("guest self-registration: an ordinary sign-up", () => {
  it("creates the group at the event's fees, linked to the parent's oldest scout, and logs it", async () => {
    const { parent, older } = await family();
    const event = await fx.event();
    const key = randomUUID();

    const result = await signUp(parent, {
      eventId: event.id,
      submissionKey: key,
      familyName: "  The Smiths  ",
      adultCount: "2",
      childCount: "3",
    });
    assert.deepEqual(result, {});

    const group = await db.prisma.eventGuestGroup.findFirstOrThrow({ where: { eventId: event.id } });
    assert.equal(group.familyName, "The Smiths");
    assert.equal(group.adultCount, 2);
    assert.equal(group.childCount, 3);
    assert.equal(group.amountOwedCents, 2 * 1000 + 3 * 500);
    assert.equal(group.addedByUserId, parent.id);
    assert.equal(group.guestOfScoutId, older.id);
    assert.equal(group.guestOfUserId, null);
    assert.equal(group.submissionKey, key);

    const audit = await db.prisma.auditLog.findFirstOrThrow({
      where: { action: "guestGroup.selfRegister", entityId: group.id },
    });
    assert.match(audit.summary, /\$35\.00 owed/);
    assert.equal(audit.actorUserId, parent.id);
    assert.ok(testState.revalidated.includes("/portal/parent"));
    assert.ok(testState.revalidated.includes("/portal/roster/family-view"));
  });

  it("links a leader's own group to the leader, and lets a den-assigned Committee Member sign up", async () => {
    const den = await fx.den("BEAR");
    const leader = await fx.user("DEN", { denIds: [den.id] });
    const committee = await fx.user("COMMITTEE", { denIds: [den.id] });
    const admin = await fx.user("ADMIN");
    const event = await fx.event();

    for (const user of [leader, committee, admin]) {
      assert.deepEqual(await signUp(user, { eventId: event.id, adultCount: 1 }), {});
      const group = await db.prisma.eventGuestGroup.findFirstOrThrow({
        where: { eventId: event.id, addedByUserId: user.id },
      });
      assert.equal(group.guestOfUserId, user.id);
      assert.equal(group.guestOfScoutId, null);
    }
  });

  it("is refused to roles that are never offered the form, and to a signed-out visitor", async () => {
    const event = await fx.event();
    const committeeWithoutDen = await fx.user("COMMITTEE");
    const counts = await writeCounts();
    for (const role of ["JUNIOR_ADMIN", "TRIP_VIEWER", "PHOTOGRAPHER", "ATTENDANCE_ADMIN"] as const) {
      const user = await fx.user(role);
      const outcome = await settle(signUp(user, { eventId: event.id, adultCount: 1 }));
      assert.equal(outcome.ok, false, role);
    }
    assert.equal((await settle(signUp(committeeWithoutDen, { eventId: event.id, adultCount: 1 }))).ok, false);
    const anonymous = await settle(
      asAnonymous(() =>
        events.registerMyGuestGroupForEventAction(
          form({ eventId: event.id, submissionKey: randomUUID(), familyName: "X", adultCount: 1 }),
        ),
      ),
    );
    assert.equal(anonymous.ok, false);
    assert.deepEqual(await writeCounts(), counts);
  });

  it("still enforces visible, upcoming events and the fees the event takes", async () => {
    const { parent } = await family();
    const hidden = await fx.event({ visible: false });
    const past = await fx.event({ eventDate: new Date("2020-01-01T00:00:00.000Z") });
    const noAdults = await fx.event({ adultFeeCents: null });
    const noKids = await fx.event({ guestChildFeeCents: null });

    await assertRefused(
      parent,
      [{ eventId: hidden.id, adultCount: 1 }, { eventId: past.id, adultCount: 1 }, { eventId: "no-such-event", adultCount: 1 }, { adultCount: 1 }],
      NOT_OPEN,
    );
    await assertRefused(parent, [{ eventId: noAdults.id, adultCount: 1 }], /adult guest self-registration/);
    await assertRefused(parent, [{ eventId: noKids.id, childCount: 1 }], /guest child self-registration/);
    // An event with no adult fee still takes kids.
    assert.deepEqual(await signUp(parent, { eventId: noAdults.id, childCount: 2 }), {});
  });
});

describe("guest self-registration: input bounds", () => {
  it("takes up to 10 people and refuses 11, with nothing written", async () => {
    const { parent } = await family();
    const event = await fx.event();

    assert.deepEqual(await signUp(parent, { eventId: event.id, adultCount: 6, childCount: 4 }), {});
    assert.deepEqual(await signUp(parent, { eventId: event.id, adultCount: 10, childCount: 0 }), {});

    await assertRefused(
      parent,
      [
        { eventId: event.id, adultCount: 6, childCount: 5 },
        { eventId: event.id, adultCount: 11 },
        { eventId: event.id, childCount: 11 },
        { eventId: event.id, adultCount: 100_000 },
        { eventId: event.id, adultCount: "9007199254740993" },
        { eventId: event.id, adultCount: "1".repeat(400) },
      ],
      /limited to 10 people per group/,
    );
  });

  it("refuses a blank, oversize or 100,000-character name, with nothing written", async () => {
    const { parent } = await family();
    const event = await fx.event();

    await assertRefused(parent, [{ eventId: event.id, familyName: "   ", adultCount: 1 }], /Enter a family or guest name/);
    await assertRefused(
      parent,
      [
        { eventId: event.id, familyName: "x".repeat(121), adultCount: 1 },
        { eventId: event.id, familyName: "x".repeat(100_000), adultCount: 1 },
      ],
      /120 characters or fewer/,
    );
    assert.deepEqual(await signUp(parent, { eventId: event.id, familyName: "y".repeat(120), adultCount: 1 }), {});
  });

  it("refuses counts that aren't plain whole numbers", async () => {
    const { parent } = await family();
    const event = await fx.event();
    const spellings = ["1e3", "0x10", "2.0", "-1", "+3", "1 2", "1_0", "Infinity", "NaN", "٣", "0b11", "1,000"];
    await assertRefused(
      parent,
      spellings.map((raw) => ({ eventId: event.id, adultCount: raw })),
      /as a whole number/,
    );
    await assertRefused(
      parent,
      spellings.map((raw) => ({ eventId: event.id, childCount: raw })),
      /as a whole number/,
    );
    await assertRefused(parent, [{ eventId: event.id, adultCount: 0, childCount: 0 }], /at least one adult or child/);
  });

  it("refuses a total that overflows one amount after multiplying, instead of storing or wrapping it", async () => {
    const { parent } = await family();
    // $1,000,000 a head is the most any fee field accepts; an older row could
    // hold more, close to the 32-bit column's limit.
    const maxFee = await fx.event({ adultFeeCents: 100_000_000, guestChildFeeCents: 100_000_000 });
    const legacyFee = await fx.event({ adultFeeCents: 2_000_000_000 });

    assert.deepEqual(await signUp(parent, { eventId: maxFee.id, adultCount: 1 }), {});
    await assertRefused(
      parent,
      [
        { eventId: maxFee.id, adultCount: 2 },
        { eventId: maxFee.id, adultCount: 1, childCount: 1 },
        { eventId: legacyFee.id, adultCount: 2 },
      ],
      /more than the portal can record/,
    );
  });

  it("refuses a missing or malformed submission key", async () => {
    const { parent } = await family();
    const event = await fx.event();
    await assertRefused(
      parent,
      [
        { eventId: event.id, adultCount: 1, submissionKey: "" },
        { eventId: event.id, adultCount: 1, submissionKey: "short" },
        { eventId: event.id, adultCount: 1, submissionKey: "x".repeat(65) },
        { eventId: event.id, adultCount: 1, submissionKey: "not a key; drop table" },
      ],
      STALE_FORM,
    );
  });
});

describe("guest self-registration: one group per submission", () => {
  it("makes one group from the same form sent twice, and another from a fresh form", async () => {
    const { parent } = await family();
    const event = await fx.event();
    const key = randomUUID();

    assert.deepEqual(await signUp(parent, { eventId: event.id, submissionKey: key, adultCount: 2 }), {});
    assert.deepEqual(await signUp(parent, { eventId: event.id, submissionKey: key, adultCount: 2 }), {});
    const group = await db.prisma.eventGuestGroup.findFirstOrThrow({ where: { eventId: event.id } });
    assert.equal(await db.prisma.eventGuestGroup.count({ where: { eventId: event.id } }), 1);
    assert.equal(await db.prisma.auditLog.count({ where: { entityId: group.id } }), 1, "one audit entry");

    assert.deepEqual(await signUp(parent, { eventId: event.id, submissionKey: randomUUID(), adultCount: 2 }), {});
    assert.equal(await db.prisma.eventGuestGroup.count({ where: { eventId: event.id } }), 2);
  });

  it("refuses a key that already made a group for another event or another login", async () => {
    const { parent } = await family();
    const other = await fx.user("PARENT");
    const first = await fx.event();
    const second = await fx.event();
    const key = randomUUID();

    assert.deepEqual(await signUp(parent, { eventId: first.id, submissionKey: key, adultCount: 1 }), {});
    await assertRefused(parent, [{ eventId: second.id, submissionKey: key, adultCount: 1 }], STALE_FORM);
    await assertRefused(other, [{ eventId: first.id, submissionKey: key, adultCount: 1 }], STALE_FORM);
  });

  it("makes one group when two copies of one request arrive together", async (t) => {
    const { parent } = await family();
    const event = await fx.event();
    const key = randomUUID();

    // Hold the event's row so both copies are in flight at once, then let go.
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(`SELECT id FROM "Event" WHERE id = $1 FOR UPDATE`, [event.id]);
    const first = signUp(parent, { eventId: event.id, submissionKey: key, adultCount: 3 });
    const second = signUp(parent, { eventId: event.id, submissionKey: key, adultCount: 3 });
    await waitForLockWaiters(db.pool, 2);
    await holder.commit();

    assert.deepEqual(await Promise.all([first, second]), [{}, {}]);
    const groups = await db.prisma.eventGuestGroup.findMany({ where: { eventId: event.id } });
    assert.equal(groups.length, 1);
    assert.equal(groups[0].submissionKey, key);
    assert.equal(await db.prisma.auditLog.count({ where: { entityId: groups[0].id } }), 1);
  });

  it("holds under repetition: 20 rounds of a doubled request each make exactly one group", async () => {
    const { parent } = await family();
    for (let round = 0; round < 20; round++) {
      const event = await fx.event();
      const key = randomUUID();
      const results = await Promise.all([
        signUp(parent, { eventId: event.id, submissionKey: key, adultCount: 1 }),
        signUp(parent, { eventId: event.id, submissionKey: key, adultCount: 1 }),
      ]);
      assert.deepEqual(results, [{}, {}], `round ${round}`);
      assert.equal(await db.prisma.eventGuestGroup.count({ where: { eventId: event.id } }), 1, `round ${round}`);
    }
  });

  it("the unique index refuses a duplicate key even with the app's own check out of the way", async (t) => {
    const { parent } = await family();
    const taken = await fx.event();
    const target = await fx.event();
    const key = randomUUID();

    // Another request's insert with this key, not yet committed: the action's
    // own lookup can't see it, so only the index stands in the way.
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(
      `INSERT INTO "EventGuestGroup" (id, "eventId", "familyName", "adultCount", "childCount", "amountOwedCents", "addedByUserId", "guestOfUserId", "submissionKey")
       VALUES ($1, $2, 'Holder', 1, 0, 1000, $3, $3, $4)`,
      [`holder-${randomUUID()}`, taken.id, parent.id, key],
    );
    const pending = signUp(parent, { eventId: target.id, submissionKey: key, adultCount: 1 });
    await waitForLockWait(db.pool);
    await holder.commit();

    assert.match((await pending).error ?? "", STALE_FORM);
    assert.equal(await db.prisma.eventGuestGroup.count({ where: { eventId: target.id } }), 0);
    assert.equal(await db.prisma.eventGuestGroup.count({ where: { submissionKey: key } }), 1);

    await assert.rejects(
      db.pool.query(
        `INSERT INTO "EventGuestGroup" (id, "eventId", "familyName", "adultCount", "childCount", "amountOwedCents", "submissionKey")
         VALUES ($1, $2, 'Direct', 1, 0, 0, $3)`,
        [`direct-${randomUUID()}`, target.id, key],
      ),
      (error: { code?: string }) => error.code === "23505",
    );
  });

  it("goes ahead when the other request holding the key rolls back", async (t) => {
    const { parent } = await family();
    const taken = await fx.event();
    const target = await fx.event();
    const key = randomUUID();

    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(
      `INSERT INTO "EventGuestGroup" (id, "eventId", "familyName", "adultCount", "childCount", "amountOwedCents", "submissionKey")
       VALUES ($1, $2, 'Holder', 1, 0, 1000, $3)`,
      [`holder-${randomUUID()}`, taken.id, key],
    );
    const pending = signUp(parent, { eventId: target.id, submissionKey: key, adultCount: 1 });
    await waitForLockWait(db.pool);
    await holder.rollback();

    assert.deepEqual(await pending, {});
    assert.equal(await db.prisma.eventGuestGroup.count({ where: { eventId: target.id, submissionKey: key } }), 1);
  });
});

describe("guest self-registration: groups per login per event", () => {
  it("allows five groups, refuses a sixth, and frees a place when one is withdrawn", async () => {
    const { parent } = await family();
    const event = await fx.event();
    for (let i = 0; i < 5; i++) {
      assert.deepEqual(await signUp(parent, { eventId: event.id, adultCount: 1 }), {}, `group ${i + 1}`);
    }
    await assertRefused(parent, [{ eventId: event.id, adultCount: 1 }], /already have 5 guest groups/);

    const one = await db.prisma.eventGuestGroup.findFirstOrThrow({ where: { eventId: event.id } });
    await runAs(parent, () => events.removeMyGuestGroupAction(form({ guestGroupId: one.id })));
    assert.deepEqual(await signUp(parent, { eventId: event.id, adultCount: 1 }), {});
    assert.equal(await db.prisma.eventGuestGroup.count({ where: { eventId: event.id } }), 5);
  });

  it("counts per login and per event: other families, other events and Admin-added groups aren't counted", async () => {
    const { parent } = await family();
    const neighbor = await fx.user("PARENT");
    const event = await fx.event();
    const another = await fx.event();
    await db.prisma.eventGuestGroup.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        eventId: event.id,
        familyName: `Admin-added ${i}`,
        adultCount: 1,
        amountOwedCents: 1000,
      })),
    });
    for (let i = 0; i < 5; i++) await signUp(parent, { eventId: event.id, adultCount: 1 });

    assert.deepEqual(await signUp(neighbor, { eventId: event.id, adultCount: 1 }), {});
    assert.deepEqual(await signUp(parent, { eventId: another.id, adultCount: 1 }), {});
    await assertRefused(parent, [{ eventId: event.id, adultCount: 1 }], /already have 5/);
  });

  it("gives the last place to exactly one of two sign-ups that arrive together", async (t) => {
    const { parent } = await family();
    const event = await fx.event();
    for (let i = 0; i < 4; i++) await signUp(parent, { eventId: event.id, adultCount: 1 });

    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(`SELECT id FROM "Event" WHERE id = $1 FOR UPDATE`, [event.id]);
    const first = signUp(parent, { eventId: event.id, adultCount: 1 });
    const second = signUp(parent, { eventId: event.id, adultCount: 1 });
    await waitForLockWaiters(db.pool, 2);
    await holder.commit();

    const results = await Promise.all([first, second]);
    assert.equal(results.filter((r) => !r.error).length, 1, JSON.stringify(results));
    assert.match(results.find((r) => r.error)?.error ?? "", /already have 5/);
    assert.equal(await db.prisma.eventGuestGroup.count({ where: { eventId: event.id } }), 5);
  });

  it("holds under repetition: 20 rounds racing for the last place never go over five", async () => {
    const { parent } = await family();
    for (let round = 0; round < 20; round++) {
      const event = await fx.event();
      await db.prisma.eventGuestGroup.createMany({
        data: Array.from({ length: 4 }, () => ({
          eventId: event.id,
          familyName: "Earlier",
          adultCount: 1,
          amountOwedCents: 1000,
          addedByUserId: parent.id,
        })),
      });
      const results = await Promise.all([
        signUp(parent, { eventId: event.id, adultCount: 1 }),
        signUp(parent, { eventId: event.id, adultCount: 1 }),
      ]);
      assert.equal(results.filter((r) => !r.error).length, 1, `round ${round}: ${JSON.stringify(results)}`);
      assert.equal(await db.prisma.eventGuestGroup.count({ where: { eventId: event.id } }), 5, `round ${round}`);
    }
  });

  it("waits for an Admin's edit to the event and charges the fee it leaves behind", async (t) => {
    const { parent } = await family();
    const event = await fx.event({ adultFeeCents: 1000 });

    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(`UPDATE "Event" SET "adultFeeCents" = 1500 WHERE id = $1`, [event.id]);
    const pending = signUp(parent, { eventId: event.id, adultCount: 2 });
    await waitForLockWait(db.pool);
    await holder.commit();

    assert.deepEqual(await pending, {});
    const group = await db.prisma.eventGuestGroup.findFirstOrThrow({ where: { eventId: event.id } });
    assert.equal(group.amountOwedCents, 3000);
  });

  it("refuses once an Admin hides the event while the sign-up waits", async (t) => {
    const { parent } = await family();
    const event = await fx.event();

    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(`UPDATE "Event" SET visible = false WHERE id = $1`, [event.id]);
    const pending = signUp(parent, { eventId: event.id, adultCount: 1 });
    await waitForLockWait(db.pool);
    await holder.commit();

    assert.match((await pending).error ?? "", NOT_OPEN);
    assert.equal(await db.prisma.eventGuestGroup.count({ where: { eventId: event.id } }), 0);
  });
});
