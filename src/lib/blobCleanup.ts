import "server-only";
import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";

/**
 * The pack's own Blob store, by exact hostname. Duplicated from next.config.ts
 * rather than shared: next.config.ts is compiled on its own, outside the app's
 * module graph and path aliases — the same reason src/proxy.ts keeps its own
 * copy of the route rules. Keep the two in sync by hand.
 */
const BLOB_HOSTNAME = "jyclzu7uphezevn7.public.blob.vercel-storage.com";

/** Every prefix this app uploads under. Matches BLOB_PATHNAMES in next.config.ts. */
const OWNED_PREFIXES = ["/album-covers/", "/event-flyers/", "/trip-flyers/"];

/**
 * The real store, plus — only under NODE_ENV=test, and only when a test file
 * names it in TEST_BLOB_HOSTNAME — the stand-in store tests/support/mocks/blob.mjs
 * hands out URLs on. Production never runs with NODE_ENV=test (Next.js fixes
 * it to "production" at build time), and the store's token couldn't delete
 * from another store anyway.
 */
function isOwnedHostname(hostname: string) {
  if (hostname === BLOB_HOSTNAME) return true;
  return process.env.NODE_ENV === "test" && !!process.env.TEST_BLOB_HOSTNAME && hostname === process.env.TEST_BLOB_HOSTNAME;
}

/**
 * True only for a URL this app uploaded itself. Stored URL columns have held
 * other things over time (cover images used to be pasted PhotoPrism links),
 * and a delete is not undoable — so cleanup refuses anything it can't prove
 * it owns rather than trusting whatever string is in the column.
 */
function isOwnedBlobUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || !isOwnedHostname(url.hostname)) return false;
  return OWNED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

/**
 * Whether any row still points at this object. Every column that stores an
 * uploaded object's URL must be listed here: an object one of them uses is
 * never deleted, whatever asked for it — a caller that ran before its own
 * write committed, a save that reported failure after it had actually
 * committed, or a queued retry hours later.
 */
async function isBlobUrlInUse(url: string): Promise<boolean> {
  const [albums, events, trips] = await Promise.all([
    prisma.photoAlbum.count({ where: { coverImageUrl: url } }),
    prisma.event.count({ where: { flyerUrl: url } }),
    prisma.tripPage.count({ where: { flyerUrl: url } }),
  ]);
  return albums + events + trips > 0;
}

const MINUTE = 60 * 1000;
/** How long a worker holds a queued row while it tries the delete. */
const CLAIM_MS = 5 * MINUTE;
/** How long to leave an object that was still in use when its deletion was asked for. */
const IN_USE_RECHECK_MS = 60 * MINUTE;
/** Queued rows tried per call, so a backlog never makes one admin's save slow. */
const BATCH_SIZE = 5;

/** Wait before try number `attempt` (1, 2, …): 2, 4, 8 … minutes, at most a day. */
function retryDelayMs(attempt: number) {
  return Math.min(2 ** Math.min(attempt, 11) * MINUTE, 24 * 60 * MINUTE);
}

function errorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

/**
 * Puts a URL on the retry queue (or, if it's already there, brings its next
 * try forward to `nextAttemptAt` when that's sooner). Never throws: if even
 * this fails, the URL is logged so it can be removed by hand.
 */
async function queueDeletion(url: string, reason: string, nextAttemptAt: Date, lastError: string | null) {
  try {
    await prisma.pendingBlobDeletion.createMany({
      data: [{ url, reason, nextAttemptAt, lastError }],
      skipDuplicates: true,
    });
    await prisma.pendingBlobDeletion.updateMany({
      where: { url, nextAttemptAt: { gt: nextAttemptAt } },
      data: { nextAttemptAt, ...(lastError ? { lastError } : {}) },
    });
  } catch (error) {
    console.error(
      `[blob cleanup] couldn't queue ${url} for deletion — remove it by hand from the Vercel dashboard if it is still there`,
      error,
    );
  }
}

/**
 * Deletes the object now if nothing uses it, or queues it to be tried again.
 * Never deletes without first seeing that no row uses it: when that can't be
 * checked (the database is unreachable), the object is queued instead.
 */
async function deleteOrQueue(url: string, reason: string) {
  let inUse: boolean;
  try {
    inUse = await isBlobUrlInUse(url);
  } catch (error) {
    console.error(`[blob cleanup] couldn't check whether ${url} is still in use; queued for later`, error);
    await queueDeletion(url, reason, new Date(Date.now() + MINUTE), errorText(error));
    return;
  }
  if (inUse) {
    // Most likely a caller still inside its own transaction; look again later.
    console.warn(`[blob cleanup] ${url} is still in use, so it was not deleted; it will be checked again later`);
    await queueDeletion(url, reason, new Date(Date.now() + IN_USE_RECHECK_MS), null);
    return;
  }
  try {
    await del(url);
  } catch (error) {
    console.error(`[blob cleanup] failed to delete ${url}; queued to try again`, error);
    await queueDeletion(url, reason, new Date(Date.now() + retryDelayMs(1)), errorText(error));
  }
}

/**
 * Deletes an uploaded object from Blob storage once the database row that
 * referenced it is gone or has been pointed somewhere else.
 *
 * Without this, deleting an album or replacing a cover only removed the
 * listing: the object stayed public at its original URL forever, so anyone
 * who had that URL kept the image. That matters most in the case the delete
 * button is usually pressed for — a family asking for a photo to come down.
 *
 * Call it *after* the database write has committed, never before or inside
 * the transaction: an orphaned object is a much better failure than a live
 * row pointing at an image that no longer exists, and an object some row
 * still uses is never deleted (see isBlobUrlInUse). It doesn't throw. If the
 * delete fails (a storage outage), the URL goes on a retry queue
 * (PendingBlobDeletion) that later uploads and deletions work through; only
 * if the queue can't be written either is the URL just logged for removal by
 * hand. Image and CDN caches can still serve a deleted object for a while.
 */
export async function deleteUploadedBlob(url: string | null | undefined): Promise<void> {
  if (!url || !isOwnedBlobUrl(url)) return;
  await deleteOrQueue(url, "replaced or removed");
  await processPendingBlobDeletions();
}

/**
 * For an object this request has just uploaded when the database save that
 * was meant to point at it failed: removes it, so it isn't left public with
 * nothing linking to it. Same rules as deleteUploadedBlob — ownership
 * checked, never deleted while a row uses it (a save that errored after
 * actually committing), queued if the delete or the check can't happen now.
 * Doesn't throw, so it's safe in a catch block.
 */
export async function discardUnsavedUpload(url: string | null | undefined): Promise<void> {
  if (!url || !isOwnedBlobUrl(url)) return;
  await deleteOrQueue(url, "upload whose save failed");
}

/** One queued row, already claimed by this worker. */
async function retryQueuedDeletion(row: { id: string; url: string; attempts: number }) {
  const forget = () => prisma.pendingBlobDeletion.deleteMany({ where: { id: row.id } });
  if (!isOwnedBlobUrl(row.url)) {
    console.warn(`[blob cleanup] dropped a queued URL this app doesn't own: ${row.url}`);
    await forget();
    return;
  }
  // If this check fails the claim simply runs out and a later call retries.
  if (await isBlobUrlInUse(row.url)) {
    console.warn(`[blob cleanup] ${row.url} is in use again, so its queued deletion was dropped`);
    await forget();
    return;
  }
  try {
    await del(row.url);
  } catch (error) {
    console.error(`[blob cleanup] retry ${row.attempts} failed to delete ${row.url}`, error);
    await prisma.pendingBlobDeletion.updateMany({
      where: { id: row.id },
      data: { lastError: errorText(error), nextAttemptAt: new Date(Date.now() + retryDelayMs(row.attempts + 1)) },
    });
    return;
  }
  await forget();
}

/**
 * Works through up to `limit` queued deletions that are due. Called from
 * deleteUploadedBlob and after each upload, so the queue drains as the site
 * is used, without a cron job or a secret. Never throws.
 *
 * Each row is claimed before it's tried — its nextAttemptAt is moved forward
 * only if it still holds the value just read — so two requests working the
 * queue at once never try the same object, and no database lock is held while
 * Blob storage is called.
 */
export async function processPendingBlobDeletions(limit = BATCH_SIZE): Promise<void> {
  try {
    const due = await prisma.pendingBlobDeletion.findMany({
      where: { nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: "asc" },
      take: limit,
      select: { id: true, url: true, attempts: true, nextAttemptAt: true },
    });
    for (const row of due) {
      const claimed = await prisma.pendingBlobDeletion.updateMany({
        where: { id: row.id, nextAttemptAt: row.nextAttemptAt },
        data: { nextAttemptAt: new Date(Date.now() + CLAIM_MS), attempts: { increment: 1 } },
      });
      if (claimed.count !== 1) continue; // another request has it
      await retryQueuedDeletion({ id: row.id, url: row.url, attempts: row.attempts + 1 });
    }
  } catch (error) {
    console.error("[blob cleanup] couldn't work through the deletion queue", error);
  }
}
