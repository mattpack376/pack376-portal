/*
 * The trip Event Details form's flyer: replacing and removing it delete the
 * file it replaced, a save that fails after its upload deletes the file it
 * just uploaded, and upload failures read as something the admin can act on.
 * Real Postgres; uploads come back on the pack's own Blob host (see
 * tripBlobOnPackHost.mjs), so cleanup's deletes are visible.
 */
import { rejectNextUpload } from "./tripBlobOnPackHost.mjs";
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { openTransaction, withTestDatabase } from "../support/db";
import { form, resetTestState, runAs, settle, testState, type SessionUser } from "../support/context";
import { createUser, freshTrip, loadTripActions, LOCK_TRIP, waitForWaiters, type TripActions } from "./tripHelpers";

const db = withTestDatabase("trip_flyer_save");
let actions: TripActions;
let admin: SessionUser;

/** A flyer URL on the pack's real Blob store, which cleanup will delete. */
const OWNED_FLYER = "https://jyclzu7uphezevn7.public.blob.vercel-storage.com/trip-flyers/old-flyer.png";

before(async () => {
  await db.ready;
  actions = await loadTripActions();
  admin = await createUser(db.prisma, "ADMIN");
});

beforeEach(() => resetTestState());

const saveDetails = (tripPageId: string, extra: Record<string, string | File> = {}) => {
  const data = form({ id: tripPageId, title: "Test Cyclones Overnight", startDate: "2027-04-23", endDate: "", location: "" });
  for (const [key, value] of Object.entries(extra)) data.set(key, value);
  return runAs(admin, () => actions.page.updateTripDetailsAction(data));
};
/**
 * A small but real PDF — its signature at the start and an end-of-file
 * marker — so it passes the upload-validation module's checks of what a file
 * really is, as well as flyerUpload.ts's type check.
 */
const pdf = () =>
  new File(["%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"], "flyer.pdf", {
    type: "application/pdf",
  });
const flyerOf = async (tripPageId: string) => (await db.prisma.tripPage.findUniqueOrThrow({ where: { id: tripPageId } })).flyerUrl;

describe("the trip details form's flyer", () => {
  it("uploads to the pack's Blob host in these tests", async () => {
    const trip = await freshTrip(db.prisma);
    assert.deepEqual(await saveDetails(trip.id, { flyer: pdf() }), {});
    assert.equal(testState.blobPuts.length, 1);
    assert.match(testState.blobPuts[0].url, /^https:\/\/jyclzu7uphezevn7\.public\.blob\.vercel-storage\.com\/trip-flyers\/.+\.pdf$/);
    assert.equal(await flyerOf(trip.id), testState.blobPuts[0].url);
  });

  it("replaces the flyer and deletes the one it replaced", async () => {
    const trip = await freshTrip(db.prisma, { flyerUrl: OWNED_FLYER });
    assert.deepEqual(await saveDetails(trip.id, { flyer: pdf() }), {});
    assert.equal(testState.blobPuts.length, 1);
    assert.equal(await flyerOf(trip.id), testState.blobPuts[0].url);
    assert.deepEqual(testState.blobDeletes, [OWNED_FLYER]);
  });

  it("two replacements at once each delete only the flyer they replaced", async (t) => {
    const trip = await freshTrip(db.prisma, { flyerUrl: OWNED_FLYER });
    // Both saves upload, then queue for the trip row. (The old action read
    // the current flyer before queueing, so both read the original, both
    // deleted it, and the first one's new upload was left orphaned.)
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(LOCK_TRIP, [trip.id]);
    const saving = [saveDetails(trip.id, { flyer: pdf() }), saveDetails(trip.id, { flyer: pdf() })];
    await waitForWaiters(db.pool, 2);
    await holder.rollback();
    assert.deepEqual(await Promise.all(saving), [{}, {}]);

    const current = await flyerOf(trip.id);
    const uploads = testState.blobPuts.map((put) => put.url);
    assert.equal(uploads.length, 2);
    assert.ok(current && uploads.includes(current), "the trip shows one of the two uploads");
    const replacedUpload = uploads.find((url) => url !== current);
    // Every flyer that was replaced is deleted exactly once — the original by
    // whichever save went first, that save's upload by the second — and the
    // one the trip now shows is never deleted.
    assert.deepEqual([...testState.blobDeletes].sort(), [OWNED_FLYER, replacedUpload].sort());
  });

  it("refuses an impossible date or an end before the start without uploading", async () => {
    const trip = await freshTrip(db.prisma, { flyerUrl: OWNED_FLYER });
    assert.match((await saveDetails(trip.id, { startDate: "2027-02-30", flyer: pdf() })).error ?? "", /isn't a real date/);
    assert.match((await saveDetails(trip.id, { endDate: "2027-04-01", flyer: pdf() })).error ?? "", /end date/);
    assert.equal(testState.blobPuts.length, 0);
    assert.deepEqual(testState.blobDeletes, []);
    assert.equal(await flyerOf(trip.id), OWNED_FLYER);
  });

  it("deletes the just-uploaded flyer when the trip was removed before the save", async () => {
    const trip = await freshTrip(db.prisma, { flyerUrl: OWNED_FLYER });
    await db.prisma.tripPage.delete({ where: { id: trip.id } });
    const result = await saveDetails(trip.id, { flyer: pdf() });
    assert.deepEqual(result, { error: "This event's page no longer exists. Reload the page.", stale: true });
    assert.equal(testState.blobPuts.length, 1);
    assert.deepEqual(testState.blobDeletes, [testState.blobPuts[0].url], "the new upload is deleted, nothing else");
  });

  it("deletes the just-uploaded flyer when the trip is removed while the save waits for it", async (t) => {
    const trip = await freshTrip(db.prisma, { flyerUrl: OWNED_FLYER });
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(LOCK_TRIP, [trip.id]);
    const saving = saveDetails(trip.id, { flyer: pdf() });
    await waitForWaiters(db.pool, 1);
    await holder.query(`DELETE FROM "TripPage" WHERE "id" = $1`, [trip.id]);
    await holder.commit();
    assert.match((await saving).error ?? "", /no longer exists/);
    assert.equal(testState.blobPuts.length, 1);
    assert.deepEqual(testState.blobDeletes, [testState.blobPuts[0].url]);
  });

  it("deletes the just-uploaded flyer when the database refuses the save, keeping the old one", async () => {
    const trip = await freshTrip(db.prisma, { flyerUrl: OWNED_FLYER });
    // Postgres can't store a NUL character in text, so the UPDATE itself
    // fails — a real database error, not one of the form's refusals, so it
    // still goes to the error page.
    const saved = await settle(saveDetails(trip.id, { title: "Broken\u0000title", flyer: pdf() }));
    assert.equal(saved.ok, false);
    assert.equal(testState.blobPuts.length, 1);
    assert.deepEqual(testState.blobDeletes, [testState.blobPuts[0].url]);
    const after = await db.prisma.tripPage.findUniqueOrThrow({ where: { id: trip.id } });
    assert.equal(after.flyerUrl, OWNED_FLYER);
    assert.equal(after.title, "Test Cyclones Overnight");
  });

  it("explains a refused file in the admin's terms, and never shows storage errors' own text", async () => {
    const trip = await freshTrip(db.prisma, { flyerUrl: OWNED_FLYER });

    // A file of the wrong type: before the upload-validation module, a plain
    // Error from flyerUpload.ts, answered with the general message (which
    // says what a flyer has to be); with it, its own wording. Either way the
    // admin is told the types a flyer can be.
    const text = new File(["hello"], "flyer.txt", { type: "text/plain" });
    assert.match((await saveDetails(trip.id, { flyer: text })).error ?? "", /a JPEG, PNG, WEBP, GIF, or PDF/);

    // A rejection the upload-validation module words for the admin is shown as written.
    rejectNextUpload("Flyer looks like a web page, not a PDF. Choose the flyer file itself.");
    assert.deepEqual(await saveDetails(trip.id, { flyer: pdf() }), {
      error: "Flyer looks like a web page, not a PDF. Choose the flyer file itself.",
    });

    // A storage failure: the SDK's text (here the stand-in's) stays in the log.
    testState.failBlobPut = true;
    const failed = await saveDetails(trip.id, { flyer: pdf() });
    assert.match(failed.error ?? "", /couldn't be uploaded/);
    assert.doesNotMatch(failed.error ?? "", /Simulated|Blob/);

    assert.equal(testState.blobPuts.length, 0);
    assert.deepEqual(testState.blobDeletes, []);
    assert.equal(await flyerOf(trip.id), OWNED_FLYER);
  });

  it("removes the flyer, deleting the file", async () => {
    const trip = await freshTrip(db.prisma, { flyerUrl: OWNED_FLYER });
    assert.deepEqual(await saveDetails(trip.id, { removeFlyer: "true" }), {});
    assert.equal(await flyerOf(trip.id), null);
    assert.deepEqual(testState.blobDeletes, [OWNED_FLYER]);
  });
});
