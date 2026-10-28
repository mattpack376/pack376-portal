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
import sharp from "sharp";
import { openTransaction, waitForLockWait, withTestDatabase } from "../support/db";
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
const EVENT_GONE = "This event no longer exists — someone may have just deleted it. Nothing was saved.";

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

// A real (minimal) PDF: uploadFlyer checks the bytes, not just the name.
const flyerFile = () =>
  new File(["%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"], "flyer.pdf", {
    type: "application/pdf",
  });

describe("event flyers", () => {
  it("deletes the new upload when creating the event fails", async () => {
    const outcome = await settle(
      runAs(admin, () => events.createEventAction(eventForm({ title: FAIL_TITLE }, flyerFile()))),
    );
    assert.equal(outcome.ok, false);
    assert.equal(testState.blobPuts.length, 1);
    assert.deepEqual(cleanupCalls(), [testState.blobPuts[0].url]);
    assert.equal(await db.prisma.event.count({ where: { title: FAIL_TITLE } }), 0);
  });

  it("keeps the upload when the event is created", async () => {
    const outcome = await settle(runAs(admin, () => events.createEventAction(eventForm({ title: "Kept" }, flyerFile()))));
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
    // Some refusals don't start with "Flyer" — they still reach the form.
    const webPage = new File(["<!doctype html><html><body>hi</body></html>"], "flyer.pdf", { type: "application/pdf" });
    const html = await runAs(admin, () => events.createEventAction(eventForm({ title: "Bad flyer" }, webPage)));
    assert.match(html.error ?? "", /web page/);
    const longTitle = await runAs(admin, () => events.createEventAction(eventForm({ title: "t".repeat(121) }, flyerFile())));
    assert.match(longTitle.error ?? "", /120 characters/);
    const badDate = await runAs(admin, () =>
      events.createEventAction(eventForm({ title: "Bad date", eventDate: "2030-02-30" }, flyerFile())),
    );
    assert.match(badDate.error ?? "", /isn't a real date/);
    assert.equal(testState.blobPuts.length, 0);
    assert.equal(await db.prisma.event.count({ where: { title: { in: ["Bad flyer", "Bad date"] } } }), 0);
  });

  it("deletes the replacement, and keeps the old flyer, when updating the event fails", async () => {
    const event = await fx.event({ title: "Has a flyer", flyerUrl: "https://example.test/event-flyers/old.png" });
    const outcome = await settle(
      runAs(admin, () => events.updateEventAction(eventForm({ id: event.id, title: FAIL_TITLE }, flyerFile()))),
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
    await runAs(admin, () => events.updateEventAction(eventForm({ id: event.id, title: "Replaced" }, flyerFile())));
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

  it("deletes the replacement when the edit is refused under the event lock", async (t) => {
    // An event saved before titles were limited, edited with its long title
    // left as is, while another Admin shortens the title: the edit's check
    // against the locked row refuses it after the new flyer was uploaded.
    const longTitle = `Spring Campout ${"and more ".repeat(20)}`.trim();
    const old = "https://example.test/event-flyers/old-3.png";
    const event = await fx.event({ title: longTitle, flyerUrl: old });
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(`UPDATE "Event" SET title = 'Spring Campout' WHERE id = $1`, [event.id]);

    const pending = runAs(admin, () => events.updateEventAction(eventForm({ id: event.id, title: longTitle }, flyerFile())));
    await waitForLockWait(db.pool);
    await holder.commit();

    assert.match((await pending).error ?? "", /title to 120 characters/);
    assert.equal(testState.blobPuts.length, 1);
    assert.deepEqual(cleanupCalls(), [testState.blobPuts[0].url]);
    const saved = await db.prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    assert.equal(saved.title, "Spring Campout");
    assert.equal(saved.flyerUrl, old);
  });

  it("deletes the event's flyer, with the event, after the delete commits", async () => {
    const flyer = "https://example.test/event-flyers/delete-me.png";
    const event = await fx.event({ title: "Deleted with its flyer", flyerUrl: flyer });
    const outcome = await settle(runAs(admin, () => events.deleteEventAction(form({ id: event.id }))));
    assert.equal(outcome.ok ? "" : (outcome.error as { redirect?: string }).redirect, "/portal/admin/events");
    assert.equal(await db.prisma.event.count({ where: { id: event.id } }), 0);
    assert.deepEqual(cleanupCalls(), [flyer]);
    const audit = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "event.delete", entityId: event.id } });
    assert.match(audit.summary, /Deleted with its flyer/);

    // A second click (or another Admin) finds it gone: nothing more to do.
    cleanupCalls().length = 0;
    const again = await settle(runAs(admin, () => events.deleteEventAction(form({ id: event.id }))));
    assert.equal(again.ok ? "" : (again.error as { redirect?: string }).redirect, "/portal/admin/events");
    assert.deepEqual(cleanupCalls(), []);
    assert.equal(await db.prisma.auditLog.count({ where: { action: "event.delete", entityId: event.id } }), 1);
  });

  it("deletes the flyer an edit just put in place, when the delete waited for that edit", async (t) => {
    // Another Admin's edit is replacing the flyer and holds the event's row:
    // it has already uploaded the new flyer, and deletes the old one itself
    // once it commits. The delete has to find the new one.
    const oldFlyer = "https://example.test/event-flyers/replaced.png";
    const newFlyer = "https://example.test/event-flyers/replacement.png";
    const event = await fx.event({ title: "Delete during an edit", flyerUrl: oldFlyer });
    const edit = await openTransaction(db.pool);
    t.after(() => edit.rollback());
    await edit.query(`SELECT id FROM "Event" WHERE id = $1 FOR UPDATE`, [event.id]);
    await edit.query(`UPDATE "Event" SET "flyerUrl" = $2 WHERE id = $1`, [event.id, newFlyer]);

    const pending = settle(runAs(admin, () => events.deleteEventAction(form({ id: event.id }))));
    await waitForLockWait(db.pool);
    await edit.commit();

    const outcome = await pending;
    assert.equal(outcome.ok ? "" : (outcome.error as { redirect?: string }).redirect, "/portal/admin/events");
    assert.equal(await db.prisma.event.count({ where: { id: event.id } }), 0);
    assert.deepEqual(cleanupCalls(), [newFlyer], "the replacement is deleted, not the replaced flyer a second time");
  });

  it("uploads nothing for an event that no longer exists, and says so on the page as it loaded", async () => {
    const result = await runAs(admin, () => events.updateEventAction(eventForm({ id: "gone", title: "Whatever" }, flyerFile())));
    assert.deepEqual(result, { error: EVENT_GONE }, "not stale: the form keeps the message and what was typed");
    assert.equal(testState.blobPuts.length, 0);
    // Refreshed, the event's page could only show not-found in place of the message.
    assert.deepEqual(testState.revalidated, []);
  });

  it("deletes the new upload, and says so on the page, when the event is deleted while the edit waits for it", async (t) => {
    // Another Admin's delete holds the event's row. The edit found the event
    // before that, so it uploaded the new flyer, then finds the row gone
    // under the lock.
    const old = "https://example.test/event-flyers/deleted-meanwhile.png";
    const event = await fx.event({ title: "Deleted meanwhile", flyerUrl: old });
    const deleter = await openTransaction(db.pool);
    t.after(() => deleter.rollback());
    await deleter.query(`DELETE FROM "Event" WHERE id = $1`, [event.id]);

    const pending = runAs(admin, () => events.updateEventAction(eventForm({ id: event.id, title: "Too late" }, flyerFile())));
    await waitForLockWait(db.pool);
    await deleter.commit();

    assert.deepEqual(await pending, { error: EVENT_GONE });
    assert.equal(testState.blobPuts.length, 1);
    assert.deepEqual(cleanupCalls(), [testState.blobPuts[0].url], "the upload nothing points at is deleted");
    assert.deepEqual(testState.revalidated, []);
    assert.equal(await db.prisma.auditLog.count({ where: { action: "event.update", entityId: event.id } }), 0);
  });

  it("answers a refused flyer on the Edit Event form, uploading and changing nothing", async () => {
    // A web page saved as flyer.jpg: the upload checks refuse it, and the
    // edit form has to say why rather than throw to the generic error page.
    // (A real image under the wrong image label is accepted and stored as
    // what it is — see the end of this test.)
    const old = "https://example.test/event-flyers/kept.png";
    const event = await fx.event({ title: "Keeps its flyer", flyerUrl: old });
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#123456" } }).png().toBuffer();
    const webPage = new File(["<!doctype html><html><body>flyer</body></html>"], "flyer.jpg", { type: "image/jpeg" });

    const result = await runAs(admin, () =>
      events.updateEventAction(eventForm({ id: event.id, title: "New title", adultFee: "12.00" }, webPage)),
    );
    assert.match(result.error ?? "(no error)", /web page/);
    assert.equal(result.stale, undefined, "a refusal about the entries: the form puts them back");
    assert.equal(testState.blobPuts.length, 0);
    assert.deepEqual(cleanupCalls(), []);
    assert.deepEqual(testState.revalidated, [], "the page isn't refreshed under the Admin's entries");
    const unchanged = await db.prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    assert.equal(unchanged.title, "Keeps its flyer");
    assert.equal(unchanged.adultFeeCents, 1000);
    assert.equal(unchanged.flyerUrl, old);
    assert.equal(await db.prisma.auditLog.count({ where: { action: "event.update", entityId: event.id } }), 0);

    // Other mistakes on the form come back the same way.
    for (const [fields, message] of [
      [{ title: "" }, /Enter a title/],
      [{ eventDate: "2030-02-30" }, /isn't a real date/],
      [{ fee: "1e3" }, /fee per scout isn't a valid amount/],
      [{ category: "NOT_A_CATEGORY" }, /category from the list/],
    ] as [Record<string, string>, RegExp][]) {
      const refused = await runAs(admin, () => events.updateEventAction(eventForm({ id: event.id, title: "New title", ...fields })));
      assert.match(refused.error ?? "(no error)", message, JSON.stringify(fields));
    }
    assert.equal((await db.prisma.event.findUniqueOrThrow({ where: { id: event.id } })).title, "Keeps its flyer");

    // A screenshot saved as flyer.jpg (PNG bytes under a JPEG label) goes
    // through and is stored as the PNG it really is.
    const mislabeled = new File([png], "flyer.jpg", { type: "image/jpeg" });
    assert.deepEqual(
      await runAs(admin, () => events.updateEventAction(eventForm({ id: event.id, title: "New title" }, mislabeled))),
      {},
    );
    const saved = await db.prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    assert.equal(saved.title, "New title");
    assert.equal(saved.flyerUrl, testState.blobPuts[0].url);
    assert.match(testState.blobPuts[0].pathname, /\.png$/);
    assert.equal(testState.blobPuts[0].options?.contentType, "image/png");
    assert.deepEqual(cleanupCalls(), [old]);
  });
});
