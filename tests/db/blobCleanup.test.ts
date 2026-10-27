/*
 * Blob storage cleanup against a real database: an object still in use is
 * never deleted, failed deletions go on a retry queue that later requests
 * work through (two workers never taking the same row), and a fresh upload
 * whose save failed can be discarded.
 *
 * The fake @vercel/blob (tests/support/mocks/blob.mjs) hands out URLs on
 * test.public.blob.vercel-storage.com; TEST_BLOB_HOSTNAME lets blobCleanup.ts
 * treat that stand-in store as ours (only under NODE_ENV=test). Its del()
 * never fails, so failDeletes() below makes it throw by refusing the record
 * it keeps.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, type TestContext } from "node:test";
import { openTransaction, waitForLockWait, withTestDatabase } from "../support/db";
import { resetTestState, testState } from "../support/context";

process.env.TEST_BLOB_HOSTNAME = "test.public.blob.vercel-storage.com";

const db = withTestDatabase("blobcleanup");

let blobCleanup: typeof import("@/lib/blobCleanup");

const REAL = "https://jyclzu7uphezevn7.public.blob.vercel-storage.com";
let serial = 0;
const realUrl = (prefix = "album-covers") => `${REAL}/${prefix}/${(serial += 1)}-${Date.now()}.jpg`;

before(async () => {
  await db.ready;
  blobCleanup = await import("@/lib/blobCleanup");
});

beforeEach(async () => {
  resetTestState();
  await db.prisma.pendingBlobDeletion.deleteMany();
});

/** Makes the fake store's del() throw (for URLs matching `which`) until the test ends or `stop()` is called. */
function failDeletes(t: TestContext, which: (url: string) => boolean = () => true) {
  const deletes = testState.blobDeletes as string[] & { push: (...urls: string[]) => number };
  const realPush = Array.prototype.push;
  deletes.push = function (...urls: string[]) {
    if (urls.some(which)) throw new Error("Simulated Blob delete failure");
    return realPush.apply(this, urls);
  };
  const stop = () => {
    delete (deletes as { push?: unknown }).push;
  };
  t.after(stop);
  return { stop };
}

async function makeDue() {
  await db.prisma.pendingBlobDeletion.updateMany({ data: { nextAttemptAt: new Date(Date.now() - 1000) } });
}

async function makeAlbum(coverImageUrl: string | null = realUrl()) {
  return db.prisma.photoAlbum.create({
    data: { title: "Fall Campout", eventDate: new Date("2026-10-10T00:00:00Z"), photoAlbumUrl: "https://photos.example.org/s/x", coverImageUrl },
  });
}

describe("deleteUploadedBlob", () => {
  it("deletes an object of ours that nothing uses, and ignores anything it can't prove is ours", async () => {
    const ours = realUrl("event-flyers");
    await blobCleanup.deleteUploadedBlob(ours);
    assert.deepEqual(testState.blobDeletes, [ours]);

    for (const notOurs of [
      "https://photos.pack376nyc.org/api/v1/t/abc/album-covers/x.jpg",
      "https://someoneelse.public.blob.vercel-storage.com/album-covers/x.jpg",
      `${REAL}/other-folder/x.jpg`,
      `http://jyclzu7uphezevn7.public.blob.vercel-storage.com/album-covers/x.jpg`,
      "not a url",
      "",
      null,
      undefined,
    ]) {
      await blobCleanup.deleteUploadedBlob(notOurs);
    }
    assert.deepEqual(testState.blobDeletes, [ours]);
    assert.equal(await db.prisma.pendingBlobDeletion.count(), 0);
  });

  it("never deletes an object a row still points at; looks again later and drops it if still in use", async () => {
    const cover = realUrl();
    const album = await makeAlbum(cover);
    await blobCleanup.deleteUploadedBlob(cover);
    assert.deepEqual(testState.blobDeletes, []);
    const queued = await db.prisma.pendingBlobDeletion.findUniqueOrThrow({ where: { url: cover } });
    assert.ok(queued.nextAttemptAt.getTime() > Date.now() + 50 * 60 * 1000, "checked again in about an hour");

    await makeDue();
    await blobCleanup.processPendingBlobDeletions();
    assert.deepEqual(testState.blobDeletes, [], "still in use");
    assert.equal(await db.prisma.pendingBlobDeletion.count(), 0, "and no longer queued");

    // Asked while a caller's own change hadn't landed yet: deleted once it has.
    await blobCleanup.deleteUploadedBlob(cover);
    await db.prisma.photoAlbum.delete({ where: { id: album.id } });
    await makeDue();
    await blobCleanup.processPendingBlobDeletions();
    assert.deepEqual(testState.blobDeletes, [cover]);
  });

  it("queues a failed delete and retries it, with growing waits, until it works", async (t) => {
    const url = realUrl("trip-flyers");
    const outage = failDeletes(t);
    await blobCleanup.deleteUploadedBlob(url);
    let row = await db.prisma.pendingBlobDeletion.findUniqueOrThrow({ where: { url } });
    assert.equal(row.attempts, 0);
    assert.match(row.lastError ?? "", /Simulated Blob delete failure/);
    const firstWait = row.nextAttemptAt.getTime() - Date.now();
    assert.ok(firstWait > 60 * 1000, "not retried straight away");

    await blobCleanup.processPendingBlobDeletions();
    assert.equal((await db.prisma.pendingBlobDeletion.findUniqueOrThrow({ where: { url } })).attempts, 0, "not due yet");

    await makeDue();
    await blobCleanup.processPendingBlobDeletions();
    row = await db.prisma.pendingBlobDeletion.findUniqueOrThrow({ where: { url } });
    assert.equal(row.attempts, 1);
    assert.ok(row.nextAttemptAt.getTime() - Date.now() > firstWait, "waits longer after another failure");

    outage.stop();
    await makeDue();
    await blobCleanup.processPendingBlobDeletions();
    assert.deepEqual(testState.blobDeletes, [url]);
    assert.equal(await db.prisma.pendingBlobDeletion.count(), 0);
  });

  it("works a backlog off a few at a time, on later deletions", async () => {
    const backlog = Array.from({ length: 12 }, () => realUrl());
    await db.prisma.pendingBlobDeletion.createMany({ data: backlog.map((url) => ({ url, reason: "test" })) });
    await makeDue();

    const fresh = realUrl();
    await blobCleanup.deleteUploadedBlob(fresh);
    assert.equal(testState.blobDeletes.length, 1 + 5, "the deletion asked for, plus five queued ones");
    assert.equal(await db.prisma.pendingBlobDeletion.count(), 7);

    await blobCleanup.processPendingBlobDeletions();
    await blobCleanup.processPendingBlobDeletions();
    assert.equal(await db.prisma.pendingBlobDeletion.count(), 0);
    assert.deepEqual(new Set(testState.blobDeletes), new Set([fresh, ...backlog]));
    assert.equal(testState.blobDeletes.length, 13, "each object deleted once");
  });

  it("two requests working the queue at once never take the same row", async () => {
    for (let round = 0; round < 10; round++) {
      resetTestState();
      const urls = Array.from({ length: 8 }, () => realUrl());
      await db.prisma.pendingBlobDeletion.createMany({ data: urls.map((url) => ({ url, reason: "test" })) });
      await makeDue();
      await Promise.all([blobCleanup.processPendingBlobDeletions(8), blobCleanup.processPendingBlobDeletions(8)]);
      assert.equal(testState.blobDeletes.length, new Set(testState.blobDeletes).size, "no object deleted twice");
      assert.deepEqual(new Set(testState.blobDeletes), new Set(urls));
      assert.equal(await db.prisma.pendingBlobDeletion.count(), 0);
    }
  });

  it("a row another worker claims while this one waits is skipped (claim is compare-and-set)", async (t) => {
    const url = realUrl();
    await db.prisma.pendingBlobDeletion.create({ data: { url, reason: "test", nextAttemptAt: new Date(Date.now() - 1000) } });
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(`SELECT 1 FROM "PendingBlobDeletion" WHERE "url" = $1 FOR UPDATE`, [url]);

    const working = blobCleanup.processPendingBlobDeletions();
    await waitForLockWait(db.pool);
    // The other worker claims it first: moves nextAttemptAt forward and commits.
    await holder.query(`UPDATE "PendingBlobDeletion" SET "nextAttemptAt" = now() + interval '1 hour' WHERE "url" = $1`, [url]);
    await holder.commit();
    await working;

    assert.deepEqual(testState.blobDeletes, [], "this worker left it to the one that claimed it");
    assert.equal((await db.prisma.pendingBlobDeletion.findUniqueOrThrow({ where: { url } })).attempts, 0);
  });

  it("queueing the same object twice keeps one row", async (t) => {
    failDeletes(t);
    const url = realUrl();
    await Promise.all([blobCleanup.deleteUploadedBlob(url), blobCleanup.deleteUploadedBlob(url)]);
    assert.equal(await db.prisma.pendingBlobDeletion.count({ where: { url } }), 1);
  });
});

describe("discardUnsavedUpload", () => {
  it("removes a fresh upload whose save failed, but not one a row turned out to use", async () => {
    const orphan = realUrl("event-flyers");
    await blobCleanup.discardUnsavedUpload(orphan);
    assert.deepEqual(testState.blobDeletes, [orphan]);

    // The save reported an error after it had in fact committed.
    const saved = realUrl();
    await makeAlbum(saved);
    await blobCleanup.discardUnsavedUpload(saved);
    assert.deepEqual(testState.blobDeletes, [orphan]);
  });
});
