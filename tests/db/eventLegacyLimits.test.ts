/*
 * The event and guest-group limits are newer than the data: before them, an
 * event's title and description, and a guest group's name, size and amount
 * owed, could be any length or size. The edit forms send every saved value
 * back, so such a row has to stay editable (a fee or Guest Of change goes
 * through) while nothing new or changed gets past the limits. Also checked
 * here: a description is measured the way the browser's maxLength measures
 * it, and an "unchanged" value is judged against the row as locked, not as
 * the form loaded it.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { openTransaction, waitForLockWait, withTestDatabase } from "../support/db";
import { form, resetTestState, runAs, settle, type SessionUser } from "../support/context";
import { packFixtures } from "./fixtures/pack";

const db = withTestDatabase("event_legacy_limits");
let events: typeof import("@/lib/actions/events");
let guestGroupEditVersion: typeof import("@/lib/eventEditVersion").guestGroupEditVersion;
let fx: ReturnType<typeof packFixtures>;
let admin: SessionUser;

before(async () => {
  await db.ready;
  events = await import("@/lib/actions/events");
  ({ guestGroupEditVersion } = await import("@/lib/eventEditVersion"));
  fx = packFixtures(db.prisma);
  admin = await fx.user("ADMIN");
});

beforeEach(() => resetTestState());

type Fields = Record<string, string | number | undefined>;

/**
 * Lines of text joined with line breaks: `length` characters in all as the
 * browser counts them (a break is one), never starting or ending with one.
 */
function paragraphs(length: number, lineBreak: string, seed = "a") {
  let text = "";
  for (let i = 0; i < length; i++) text += i % 50 === 49 && i < length - 1 ? lineBreak : seed;
  return text;
}

const LONG_TITLE = `Spring Family Campout at Alpine Scout Camp — ${"with a very long name ".repeat(12)}`.trim();
// Saved the way the form sends it: a textarea's line breaks arrive as CRLF.
const LONG_DESCRIPTION = paragraphs(5000, "\r\n", "d");

/** An event saved before the limits: a 300-ish character title, a 5,000-character description, a $2.5M scout fee. */
async function legacyEvent() {
  const event = await fx.event();
  return db.prisma.event.update({
    where: { id: event.id },
    data: { title: LONG_TITLE, description: LONG_DESCRIPTION, feeCents: 250_000_000 },
  });
}

/** The event's edit form as the page fills it in, then `fields`. */
function editEvent(eventId: string, fields: Fields = {}) {
  return runAs(admin, () =>
    events.updateEventAction(
      form({
        id: eventId,
        title: LONG_TITLE,
        category: "GENERAL",
        eventDate: "2030-06-01",
        description: LONG_DESCRIPTION,
        fee: "2500000.00",
        adultFee: "10.00",
        guestChildFee: "5.00",
        ...fields,
      }),
    ),
  );
}

async function eventAudits() {
  return db.prisma.auditLog.count({ where: { action: "event.update" } });
}

describe("an event saved before the limits", () => {
  it("can still be edited when its long title, description and fee come back unchanged", async () => {
    const event = await legacyEvent();
    assert.ok(LONG_TITLE.length > 120);

    await editEvent(event.id, { adultFee: "12.00" });

    const saved = await db.prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    assert.equal(saved.adultFeeCents, 1200);
    assert.equal(saved.title, LONG_TITLE);
    assert.equal(saved.description, LONG_DESCRIPTION);
    assert.equal(saved.feeCents, 250_000_000);
    const audit = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "event.update", entityId: event.id } });
    assert.deepEqual(
      (audit.details as { label: string }[]).map((d) => d.label),
      ["Adult fee"],
      "only the fee changed",
    );

    // A description saved with bare line breaks (by a script, say) still
    // counts as unchanged when the browser sends it back with CRLF.
    await db.prisma.event.update({ where: { id: event.id }, data: { description: LONG_DESCRIPTION.replace(/\r\n/g, "\n") } });
    await editEvent(event.id, { adultFee: "14.00" });
    assert.equal((await db.prisma.event.findUniqueOrThrow({ where: { id: event.id } })).adultFeeCents, 1400);
  });

  it("refuses a changed title, description or fee that doesn't fit, writing nothing", async () => {
    const event = await legacyEvent();
    const audits = await eventAudits();
    const refusals: [Fields, RegExp][] = [
      [{ title: "t".repeat(LONG_TITLE.length) }, /title to 120 characters/],
      [{ title: `${LONG_TITLE}!` }, /title to 120 characters/],
      [{ title: LONG_TITLE.slice(0, 121) }, /title to 120 characters/],
      [{ description: paragraphs(2001, "\r\n", "e") }, /description to 2000 characters/],
      [{ description: `${LONG_DESCRIPTION} more` }, /description to 2000 characters/],
      [{ fee: "2500000.01" }, /fee per scout isn't a valid amount/],
      [{ fee: "1000000.01" }, /fee per scout isn't a valid amount/],
      [{ adultFee: "2500000.00" }, /fee per adult isn't a valid amount/],
    ];
    for (const [fields, message] of refusals) {
      const result = await editEvent(event.id, { ...fields, guestChildFee: "6.00" });
      assert.match(result.error ?? "(no error)", message, JSON.stringify(fields).slice(0, 80));
    }
    const unchanged = await db.prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    assert.equal(unchanged.title, LONG_TITLE);
    assert.equal(unchanged.description, LONG_DESCRIPTION);
    assert.equal(unchanged.guestChildFeeCents, 500);
    assert.equal(await eventAudits(), audits);

    // Brought within the limits, it saves like any other event.
    await editEvent(event.id, { title: LONG_TITLE.slice(0, 120), description: "Bring a flashlight.", fee: "25.00" });
    const fixed = await db.prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    assert.equal(fixed.title, LONG_TITLE.slice(0, 120).trim());
    assert.equal(fixed.description, "Bring a flashlight.");
    assert.equal(fixed.feeCents, 2500);

    // ...and from then on the limits hold for it too.
    assert.match((await editEvent(event.id, { title: LONG_TITLE })).error ?? "(no error)", /title to 120 characters/);
  });

  it("holds new events to the limits: there is no saved value to keep", async () => {
    const before = await db.prisma.event.count();
    const outcome = await runAs(admin, () =>
      events.createEventAction(form({ title: LONG_TITLE, category: "GENERAL", eventDate: "2030-06-01" })),
    );
    assert.match(outcome.error ?? "", /title to 120 characters/);
    assert.equal(await db.prisma.event.count(), before);
  });
});

describe("description length", () => {
  it("counts a line break as one character, as the textarea's maxLength does", async () => {
    // 2,000 characters as typed, more than 2,000 as sent: each break is CRLF.
    const atLimit = paragraphs(2000, "\r\n", "f");
    assert.ok(atLimit.length > 2000);
    const created = await settle(
      runAs(admin, () =>
        events.createEventAction(
          form({ title: "Line breaks", category: "GENERAL", eventDate: "2030-06-01", description: atLimit }),
        ),
      ),
    );
    // Success ends in a redirect to the new event's page.
    assert.equal(created.ok, false);
    assert.match(String((created as { error: { redirect?: string } }).error.redirect), /^\/portal\/admin\/events\//);
    assert.equal((await db.prisma.event.findFirstOrThrow({ where: { title: "Line breaks" } })).description, atLimit);

    const overLimit = await runAs(admin, () =>
      events.createEventAction(
        form({
          title: "One too many",
          category: "GENERAL",
          eventDate: "2030-06-01",
          description: paragraphs(2001, "\r\n", "g"),
        }),
      ),
    );
    assert.match(overLimit.error ?? "", /description to 2000 characters/);
    assert.equal(await db.prisma.event.count({ where: { title: "One too many" } }), 0);
  });
});

describe("an unchanged long value is judged against the row as locked", () => {
  it("refuses the old long title once another Admin's shorter one commits first", async (t) => {
    const event = await legacyEvent();
    const audits = await eventAudits();
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(`UPDATE "Event" SET title = 'Spring Campout' WHERE id = $1`, [event.id]);

    // The edit's first read (no lock) still sees the long title, so it gets
    // as far as locking the event, and waits there.
    const pending = editEvent(event.id, { adultFee: "12.00" });
    await waitForLockWait(db.pool);
    await holder.commit();

    assert.match((await pending).error ?? "(no error)", /title to 120 characters/);
    const saved = await db.prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    assert.equal(saved.title, "Spring Campout", "the long title wasn't written back");
    assert.equal(saved.adultFeeCents, 1000);
    assert.equal(await eventAudits(), audits);
  });

  it("goes ahead when the other Admin's change rolls back", async (t) => {
    const event = await legacyEvent();
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(`UPDATE "Event" SET title = 'Spring Campout' WHERE id = $1`, [event.id]);

    const pending = editEvent(event.id, { adultFee: "12.00" });
    await waitForLockWait(db.pool);
    await holder.rollback();

    await pending;
    const saved = await db.prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    assert.equal(saved.title, LONG_TITLE);
    assert.equal(saved.adultFeeCents, 1200);
  });
});

describe("a guest group saved before the limits", () => {
  const LONG_NAME = `The ${"Extended ".repeat(16)}Family`;

  async function legacyGroup() {
    const event = await fx.event();
    const group = await db.prisma.eventGuestGroup.create({
      data: {
        eventId: event.id,
        familyName: LONG_NAME,
        adultCount: 250,
        childCount: 30,
        amountOwedCents: 200_000_000,
      },
    });
    return { event, group };
  }

  /** The group's edit form as its page fills it in (version and all), then `fields`. */
  async function editGroup(eventId: string, guestGroupId: string, fields: Fields = {}) {
    const saved = await db.prisma.eventGuestGroup.findUniqueOrThrow({ where: { id: guestGroupId } });
    return runAs(admin, () =>
      events.updateGuestGroupAction(
        form({
          guestGroupId,
          eventId,
          version: guestGroupEditVersion(saved),
          familyName: LONG_NAME,
          adultCount: 250,
          childCount: 30,
          amountOwed: "2000000.00",
          ...fields,
        }),
      ),
    );
  }

  async function groupAudits() {
    return db.prisma.auditLog.count({ where: { action: "guestGroup.update" } });
  }

  it("can still be edited when its name, size and amount come back unchanged", async () => {
    const { event, group } = await legacyGroup();
    assert.ok(LONG_NAME.length > 120);
    const den = await fx.den("WOLF");
    const scout = await fx.scout(den.id);

    await editGroup(event.id, group.id, { guestOf: `scout:${scout.id}` });

    const saved = await db.prisma.eventGuestGroup.findUniqueOrThrow({ where: { id: group.id } });
    assert.equal(saved.guestOfScoutId, scout.id);
    assert.equal(saved.familyName, LONG_NAME);
    assert.equal(saved.adultCount, 250);
    assert.equal(saved.childCount, 30);
    assert.equal(saved.amountOwedCents, 200_000_000);
  });

  it("can shrink but not grow, and refuses a changed name or amount that doesn't fit, writing nothing", async () => {
    const { event, group } = await legacyGroup();
    const audits = await groupAudits();
    const refusals: [Fields, RegExp][] = [
      [{ adultCount: 251 }, /saved with 280 people, more than the 200 a group can have now/],
      [{ adultCount: 0, childCount: 281 }, /saved with 280 people/],
      [{ familyName: "n".repeat(LONG_NAME.length) }, /name to 120 characters/],
      [{ familyName: `${LONG_NAME}s` }, /name to 120 characters/],
      [{ amountOwed: "2000000.01" }, /amount owed/],
      [{ amountOwed: "1500000.00" }, /amount owed/],
      [{ amountOwed: "2000000" }, /amount owed/],
    ];
    for (const [fields, message] of refusals) {
      const result = await editGroup(event.id, group.id, fields);
      assert.match(result.error ?? "(no error)", message, JSON.stringify(fields).slice(0, 80));
    }
    let saved = await db.prisma.eventGuestGroup.findUniqueOrThrow({ where: { id: group.id } });
    assert.deepEqual(
      [saved.familyName, saved.adultCount, saved.childCount, saved.amountOwedCents],
      [LONG_NAME, 250, 30, 200_000_000],
    );
    assert.equal(await groupAudits(), audits);

    // Shrinking is fine, and the new size becomes the ceiling.
    await editGroup(event.id, group.id, { adultCount: 200, childCount: 50 });
    saved = await db.prisma.eventGuestGroup.findUniqueOrThrow({ where: { id: group.id } });
    assert.equal(saved.adultCount + saved.childCount, 250);
    const regrow = await editGroup(event.id, group.id, { adultCount: 250, childCount: 30 });
    assert.match(regrow.error ?? "(no error)", /saved with 250 people/);

    // Once it's within the Admin ceiling, that ceiling is what holds.
    await editGroup(event.id, group.id, { adultCount: 150, childCount: 40, amountOwed: "1900.00" });
    const over = await editGroup(event.id, group.id, { adultCount: 150, childCount: 51, amountOwed: "1900.00" });
    assert.match(over.error ?? "(no error)", /at most 200 people/);

    // And a name brought within the limit stays there.
    await editGroup(event.id, group.id, { familyName: "The Extended Family", adultCount: 150, childCount: 40, amountOwed: "1900.00" });
    const rename = await editGroup(event.id, group.id, {
      familyName: LONG_NAME,
      adultCount: 150,
      childCount: 40,
      amountOwed: "1900.00",
    });
    assert.match(rename.error ?? "(no error)", /name to 120 characters/);
    saved = await db.prisma.eventGuestGroup.findUniqueOrThrow({ where: { id: group.id } });
    assert.deepEqual(
      [saved.familyName, saved.adultCount, saved.childCount, saved.amountOwedCents],
      ["The Extended Family", 150, 40, 190_000],
    );
  });
});
