/*
 * F7 follow-up: an event flyer is uploaded before the database write that
 * points at it. When that write fails, the upload has to be deleted again;
 * when it succeeds, only a replaced flyer is deleted.
 *
 * @/lib/blobCleanup is swapped for a recorder (fixtures/blobCleanupSpy.mjs) in
 * this file only: each test file runs in its own process, so no other test
 * sees the swap. The swap has to be registered before the app is imported.
 */
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { before, beforeEach, describe, it } from "node:test";
import { withTestDatabase } from "../support/db";
import { form, resetTestState, runAs, settle, testState, type SessionUser } from "../support/context";
import { packFixtures } from "./fixtures/pack";

const spyUrl = new URL("./fixtures/blobCleanupSpy.mjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/blobCleanup") return { url: spyUrl, format: "module", shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const cleanupCalls = (): string[] =>
  (globalThis as unknown as { __eventFlyerCleanupCalls?: string[] }).__eventFlyerCleanupCalls ?? [];

const db = withTestDatabase("event_flyer_cleanup");
let events: typeof import("@/lib/actions/events");
let fx: ReturnType<typeof packFixtures>;
let admin: SessionUser;

const FAIL_TITLE = "Fail this write";

before(async () => {
  await db.ready;
  events = await import("@/lib/actions/events");
  fx = packFixtures(db.prisma);
  admin = await fx.user("ADMIN");
  // A database failure on demand: any insert or update that sets this title.
  await db.pool.query(`
    CREATE FUNCTION test_fail_event_write() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.title = '${FAIL_TITLE}' THEN RAISE EXCEPTION 'simulated database failure'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER test_fail_event_write BEFORE INSERT OR UPDATE ON "Event"
      FOR EACH ROW EXECUTE FUNCTION test_fail_event_write();
  `);
});

beforeEach(() => {
  resetTestState();
  cleanupCalls().length = 0;
});

function eventForm(fields: Record<string, string>, flyer?: File) {
  const data = form({ category: "CAMPING", eventDate: "2030-05-01", ...fields });
  if (flyer) data.set("flyer", flyer);
  return data;
}

const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "flyer.png", { type: "image/png" });

describe("event flyers", () => {
  it("deletes the new upload when creating the event fails", async () => {
    const outcome = await settle(
      runAs(admin, () => events.createEventAction(eventForm({ title: FAIL_TITLE }, png()))),
    );
    assert.equal(outcome.ok, false);
    assert.equal(testState.blobPuts.length, 1);
    assert.deepEqual(cleanupCalls(), [testState.blobPuts[0].url]);
    assert.equal(await db.prisma.event.count({ where: { title: FAIL_TITLE } }), 0);
  });

  it("keeps the upload when the event is created", async () => {
    const outcome = await settle(runAs(admin, () => events.createEventAction(eventForm({ title: "Kept" }, png()))));
    // Success ends in a redirect to the new event's page.
    assert.equal(outcome.ok, false);
    assert.match(String((outcome as { error: { redirect?: string } }).error.redirect), /^\/portal\/admin\/events\//);
    const event = await db.prisma.event.findFirstOrThrow({ where: { title: "Kept" } });
    assert.equal(event.flyerUrl, testState.blobPuts[0].url);
    assert.deepEqual(cleanupCalls(), []);
  });

  it("answers a refused flyer or an oversize title on the form, uploading nothing", async () => {
    const pdfAsText = new File(["hello"], "flyer.txt", { type: "text/plain" });
    const badType = await runAs(admin, () => events.createEventAction(eventForm({ title: "Bad flyer" }, pdfAsText)));
    assert.match(badType.error ?? "", /^Flyer must be/);
    const longTitle = await runAs(admin, () => events.createEventAction(eventForm({ title: "t".repeat(121) }, png())));
    assert.match(longTitle.error ?? "", /120 characters/);
    const badDate = await runAs(admin, () =>
      events.createEventAction(eventForm({ title: "Bad date", eventDate: "2030-02-30" }, png())),
    );
    assert.match(badDate.error ?? "", /isn't a real date/);
    assert.equal(testState.blobPuts.length, 0);
    assert.equal(await db.prisma.event.count({ where: { title: { in: ["Bad flyer", "Bad date"] } } }), 0);
  });

  it("deletes the replacement, and keeps the old flyer, when updating the event fails", async () => {
    const event = await fx.event({ title: "Has a flyer", flyerUrl: "https://example.test/event-flyers/old.png" });
    const outcome = await settle(
      runAs(admin, () => events.updateEventAction(eventForm({ id: event.id, title: FAIL_TITLE }, png()))),
    );
    assert.equal(outcome.ok, false);
    assert.deepEqual(cleanupCalls(), [testState.blobPuts[0].url]);
    const unchanged = await db.prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    assert.equal(unchanged.title, "Has a flyer");
    assert.equal(unchanged.flyerUrl, "https://example.test/event-flyers/old.png");
  });

  it("deletes only the old flyer once a replacement is saved, and nothing when the flyer is left alone", async () => {
    const old = "https://example.test/event-flyers/old-2.png";
    const event = await fx.event({ title: "Replace me", flyerUrl: old });
    await runAs(admin, () => events.updateEventAction(eventForm({ id: event.id, title: "Replaced" }, png())));
    const saved = await db.prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    assert.equal(saved.flyerUrl, testState.blobPuts[0].url);
    assert.deepEqual(cleanupCalls(), [old]);

    cleanupCalls().length = 0;
    await runAs(admin, () => events.updateEventAction(eventForm({ id: event.id, title: "Left alone" })));
    assert.deepEqual(cleanupCalls(), []);
    assert.equal((await db.prisma.event.findUniqueOrThrow({ where: { id: event.id } })).flyerUrl, saved.flyerUrl);

    await runAs(admin, () =>
      events.updateEventAction(eventForm({ id: event.id, title: "Removed", removeFlyer: "true" })),
    );
    assert.deepEqual(cleanupCalls(), [saved.flyerUrl]);
    assert.equal((await db.prisma.event.findUniqueOrThrow({ where: { id: event.id } })).flyerUrl, null);
  });

  it("uploads nothing for an event that no longer exists", async () => {
    const outcome = await settle(
      runAs(admin, () => events.updateEventAction(eventForm({ id: "gone", title: "Whatever" }, png()))),
    );
    assert.equal(outcome.ok, false);
    assert.equal(testState.blobPuts.length, 0);
  });
});
