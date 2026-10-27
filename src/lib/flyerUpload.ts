import "server-only";
import { put } from "@vercel/blob";
import { processPendingBlobDeletions } from "@/lib/blobCleanup";
import { FLYER_MEDIA_TYPES, prepareUpload } from "@/lib/uploadValidation";

/**
 * Uploads an event or trip flyer to Vercel Blob and returns its public URL.
 * The folder must stay one of the prefixes next.config.ts and blobCleanup.ts
 * allow.
 *
 * The file has to really be a JPEG, PNG, WEBP, GIF or PDF — its own bytes are
 * checked, not just the type the browser reported — and 8MB or smaller.
 * Images are re-saved without their metadata (src/lib/uploadValidation.ts);
 * the stored name's extension is the file's real type, so a URL ending in
 * .pdf is a PDF. Throws an Error whose message is fit to show the admin
 * (an UploadRejectedError) for anything turned down.
 *
 * If the database write that follows fails, the caller should hand the
 * returned URL to discardUnsavedUpload (blobCleanup.ts) so the new object
 * isn't left public with nothing pointing at it.
 */
export async function uploadFlyer(file: File, folder: "event-flyers" | "trip-flyers"): Promise<string> {
  const prepared = await prepareUpload(file, { label: "Flyer", allowed: FLYER_MEDIA_TYPES });

  const blob = await put(`${folder}/${crypto.randomUUID()}.${prepared.extension}`, Buffer.from(prepared.bytes), {
    access: "public",
    contentType: prepared.contentType,
  });
  // A good moment to retry any deletion that failed earlier (bounded, never throws).
  await processPendingBlobDeletions();
  return blob.url;
}
