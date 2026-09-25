import "server-only";
import { put } from "@vercel/blob";

const MAX_FLYER_BYTES = 8 * 1024 * 1024;
const ALLOWED_FLYER_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

/**
 * Uploads an event or trip flyer to Vercel Blob and returns its public URL.
 * The folder must stay one of the prefixes next.config.ts and blobCleanup.ts
 * allow. Throws a message fit to show the admin for a wrong type or a file
 * over 8MB.
 */
export async function uploadFlyer(file: File, folder: "event-flyers" | "trip-flyers"): Promise<string> {
  const extension = ALLOWED_FLYER_TYPES[file.type];
  if (!extension) throw new Error("Flyer must be a JPEG, PNG, WEBP, GIF, or PDF.");
  if (file.size > MAX_FLYER_BYTES) throw new Error("Flyer must be 8MB or smaller.");

  const blob = await put(`${folder}/${crypto.randomUUID()}.${extension}`, file, {
    access: "public",
    contentType: file.type,
  });
  return blob.url;
}
