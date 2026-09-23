import "server-only";
import { del } from "@vercel/blob";

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
  if (url.protocol !== "https:" || url.hostname !== BLOB_HOSTNAME) return false;
  return OWNED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
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
 * Deliberately best-effort and called *after* the database write, never
 * before: an orphaned object is a much better failure than a live row
 * pointing at an image that no longer exists. A failure is logged with the
 * URL still in it so the object can be removed by hand from the Vercel
 * dashboard — this is not a retrying queue, and a storage outage at the wrong
 * moment will still leave an object behind. Image and CDN caches can also
 * serve a deleted object for a while after it goes.
 */
export async function deleteUploadedBlob(url: string | null | undefined): Promise<void> {
  if (!url || !isOwnedBlobUrl(url)) return;
  try {
    await del(url);
  } catch (error) {
    console.error(`[blob cleanup] failed to delete ${url} — remove it by hand if it is still there`, error);
  }
}
