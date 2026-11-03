"use server";

import { revalidatePath } from "next/cache";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAlbumEditAccess } from "@/lib/authorize";
import { recordAuditInTransaction } from "@/lib/audit";
import { deleteUploadedBlob, discardUnsavedUpload, processPendingBlobDeletions } from "@/lib/blobCleanup";
import { textField } from "@/lib/formValues";
import { processAlbumPhoto } from "@/lib/albumPhotoImage";
import { MAX_PHOTOS_PER_ALBUM } from "@/lib/albumPhotoRules";
import { UploadRejectedError } from "@/lib/uploadValidation";

/*
 * Event photos (AlbumPhoto): added, removed and put in order on the admin
 * Edit Album page, by the same people who edit albums (Admin and
 * Photographer). Removing a single photo is open to both, unlike deleting a
 * whole album: taking a photo down quickly is the point of the button.
 */

export type AlbumPhotoUploadResult = { ok: true } | { ok: false; error: string };

/** How long a save waits for (and may hold) the album's row lock. */
const TRANSACTION_OPTIONS = { timeout: 15000, maxWait: 10000 };

async function requireAlbumEditor() {
  const session = await getSession();
  if (!session) return null;
  try {
    assertAlbumEditAccess(session);
  } catch {
    return null;
  }
  return session;
}

function revalidateAlbum(albumId: string) {
  revalidatePath(`/portal/admin/albums/${albumId}`);
  revalidatePath("/portal/admin/albums");
  revalidatePath("/gallery");
  revalidatePath(`/gallery/${albumId}`);
}

function fullMessage() {
  return `This album already has ${MAX_PHOTOS_PER_ALBUM} photos, the most it can hold. Remove one to add another.`;
}

/**
 * Adds one photo to an album. The admin page sends photos one at a time (each
 * already shrunk in the browser), so one bad file only turns that photo away
 * and a big batch never runs into the request size limit.
 *
 * The photo is processed and uploaded before the database is touched; the
 * save then locks the album and checks the photo limit again, since two
 * uploads can be running at once. A save that doesn't go through removes the
 * files it had just uploaded.
 */
export async function uploadAlbumPhotoAction(formData: FormData): Promise<AlbumPhotoUploadResult> {
  const session = await requireAlbumEditor();
  if (!session) return { ok: false, error: "Not authorized." };
  if (!(formData instanceof FormData)) return { ok: false, error: "That request wasn't valid. Reload the page and try again." };

  const albumId = textField(formData.get("albumId"));
  const file = formData.get("photo");
  if (!albumId) return { ok: false, error: "Missing album id." };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a photo to upload." };

  // A quick look first, so a full or deleted album doesn't cost an upload.
  const album = await prisma.photoAlbum.findUnique({
    where: { id: albumId },
    select: { _count: { select: { photos: true } } },
  });
  if (!album) return { ok: false, error: "This album no longer exists — someone may have just deleted it." };
  if (album._count.photos >= MAX_PHOTOS_PER_ALBUM) return { ok: false, error: fullMessage() };

  let processed;
  try {
    processed = await processAlbumPhoto(file);
  } catch (error) {
    if (error instanceof UploadRejectedError) return { ok: false, error: error.message };
    throw error;
  }

  const key = crypto.randomUUID();
  let imageUrl: string | null = null;
  let thumbUrl: string | null = null;
  try {
    imageUrl = (await put(`album-photos/${key}.jpg`, processed.full, { access: "public", contentType: "image/jpeg" })).url;
    thumbUrl = (await put(`album-photos/${key}-thumb.jpg`, processed.thumb, { access: "public", contentType: "image/jpeg" }))
      .url;
  } catch (error) {
    console.error("[album photos] upload to Blob storage failed", error);
    await discardUnsavedUpload(imageUrl);
    return { ok: false, error: "The photo couldn't be uploaded just now. Please try again in a minute." };
  }

  let outcome: "saved" | "gone" | "full";
  try {
    outcome = await prisma.$transaction(async (tx) => {
      // Same lock the album edit and delete take, so a delete running now
      // lands wholly before or after this, and two uploads count in turn.
      await tx.$queryRaw`SELECT 1 FROM "PhotoAlbum" WHERE "id" = ${albumId} FOR UPDATE`;
      const current = await tx.photoAlbum.findUnique({ where: { id: albumId }, select: { title: true } });
      if (!current) return "gone" as const;
      const count = await tx.albumPhoto.count({ where: { albumId } });
      if (count >= MAX_PHOTOS_PER_ALBUM) return "full" as const;
      const last = await tx.albumPhoto.aggregate({ where: { albumId }, _max: { sortOrder: true } });
      await tx.albumPhoto.create({
        data: {
          albumId,
          imageUrl: imageUrl!,
          thumbUrl: thumbUrl!,
          width: processed.width,
          height: processed.height,
          sortOrder: (last._max.sortOrder ?? -1) + 1,
        },
      });
      await recordAuditInTransaction(tx, session, {
        action: "album.addPhoto",
        summary: `Added a photo to the album “${current.title}”`,
        entityType: "PhotoAlbum",
        entityId: albumId,
        details: [
          { label: "Photos", from: String(count), to: String(count + 1) },
          { label: "Photo", from: "—", to: "Uploaded (photo details removed, watermarked)" },
        ],
      });
      return "saved" as const;
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    console.error("[album photos] saving a new photo failed", error);
    await discardUnsavedUpload(imageUrl);
    await discardUnsavedUpload(thumbUrl);
    return { ok: false, error: "The photo couldn't be saved. Please try again." };
  }

  if (outcome !== "saved") {
    await discardUnsavedUpload(imageUrl);
    await discardUnsavedUpload(thumbUrl);
    return {
      ok: false,
      error: outcome === "full" ? fullMessage() : "This album no longer exists — someone may have just deleted it.",
    };
  }

  // A good moment to retry any deletion that failed earlier (bounded, never throws).
  await processPendingBlobDeletions();
  revalidateAlbum(albumId);
  return { ok: true };
}

/**
 * Removes one photo from its album and then deletes both its files from
 * storage, so it's gone from the site, not just hidden. Image caches can
 * still hold it for a while (docs/security-operations.md).
 */
export async function deleteAlbumPhotoAction(formData: FormData): Promise<void> {
  const session = await requireAlbumEditor();
  if (!session) throw new Error("Not authorized.");
  const photoId = textField(formData.get("photoId"));
  if (!photoId) throw new Error("Missing photo id.");

  const photo = await prisma.albumPhoto.findUnique({ where: { id: photoId }, select: { albumId: true } });
  if (!photo) return; // Already gone (a second click, or someone else).
  const albumId = photo.albumId;

  const removed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "PhotoAlbum" WHERE "id" = ${albumId} FOR UPDATE`;
    const current = await tx.albumPhoto.findUnique({
      where: { id: photoId },
      select: { imageUrl: true, thumbUrl: true, album: { select: { title: true } } },
    });
    if (!current) return null;
    await tx.albumPhoto.delete({ where: { id: photoId } });
    const left = await tx.albumPhoto.count({ where: { albumId } });
    await recordAuditInTransaction(tx, session, {
      action: "album.deletePhoto",
      summary: `Removed a photo from the album “${current.album.title}”`,
      entityType: "PhotoAlbum",
      entityId: albumId,
      details: [
        { label: "Photos", from: String(left + 1), to: String(left) },
        { label: "Photo", from: "Uploaded", to: "Deleted from storage" },
      ],
    });
    return current;
  }, TRANSACTION_OPTIONS);

  // After the commit, like every other cleanup.
  if (removed) {
    await deleteUploadedBlob(removed.imageUrl);
    await deleteUploadedBlob(removed.thumbUrl);
  }
  revalidateAlbum(albumId);
}

/** Moves a photo one place earlier or later in its album. */
export async function moveAlbumPhotoAction(formData: FormData): Promise<void> {
  const session = await requireAlbumEditor();
  if (!session) throw new Error("Not authorized.");
  const photoId = textField(formData.get("photoId"));
  const direction = textField(formData.get("direction"));
  if (!photoId || (direction !== "up" && direction !== "down")) throw new Error("That request wasn't valid.");

  const photo = await prisma.albumPhoto.findUnique({ where: { id: photoId }, select: { albumId: true } });
  if (!photo) return;
  const albumId = photo.albumId;

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "PhotoAlbum" WHERE "id" = ${albumId} FOR UPDATE`;
    const photos = await tx.albumPhoto.findMany({
      where: { albumId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, album: { select: { title: true } } },
    });
    const from = photos.findIndex((p) => p.id === photoId);
    const to = direction === "up" ? from - 1 : from + 1;
    if (from < 0 || to < 0 || to >= photos.length) return; // Already first/last, or gone.

    const ordered = photos.map((p) => p.id);
    [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
    // Renumbered 0, 1, 2 … every time, so the order never depends on ties.
    for (const [index, id] of ordered.entries()) {
      await tx.albumPhoto.update({ where: { id }, data: { sortOrder: index } });
    }
    await recordAuditInTransaction(tx, session, {
      action: "album.movePhoto",
      summary: `Reordered the photos in the album “${photos[from].album.title}”`,
      entityType: "PhotoAlbum",
      entityId: albumId,
      details: [{ label: "Photo position", from: String(from + 1), to: String(to + 1) }],
    });
  }, TRANSACTION_OPTIONS);

  revalidateAlbum(albumId);
}
