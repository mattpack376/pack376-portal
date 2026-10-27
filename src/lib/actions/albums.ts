"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin, assertAlbumEditAccess } from "@/lib/authorize";
import { recordAudit, recordAuditInTransaction, changedFields, auditDate } from "@/lib/audit";
import { deleteUploadedBlob, discardUnsavedUpload, processPendingBlobDeletions } from "@/lib/blobCleanup";
import { isDateOnlyString } from "@/lib/dateOnly";
import { textField } from "@/lib/formValues";
import { ALBUM_FIELD_LIMITS, normalizeLineBreaks } from "@/lib/albumFields";
import { IMAGE_MEDIA_TYPES, UploadRejectedError, prepareUpload } from "@/lib/uploadValidation";

export type AlbumActionState = { error?: string };

/**
 * Covers are stored no bigger than this on either side. The gallery shows them
 * as cards, so a full 48-megapixel phone photo would only cost storage and
 * page weight; 3,000 pixels is still crisp on a large screen.
 */
const COVER_MAX_SIDE = 3000;

/** How long an album save waits for (and may hold) the album's row lock. */
const TRANSACTION_OPTIONS = { timeout: 15000, maxWait: 10000 };

/**
 * Server-side URL guard. Browser `type="url"` validation is trivially bypassed
 * by calling the Server Action directly, so we re-parse here and allow only
 * http(s). This blocks javascript:, data:, file:, and other schemes that would
 * otherwise be stored and later rendered into an href on the public gallery.
 */
function isSafeHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

type AlbumFields = { title: string; eventDate: Date; description: string; photoAlbumUrl: string };

/**
 * The album form's text fields, checked. Done before any cover upload, so a
 * typo in the title never leaves an uploaded photo behind.
 */
function readAlbumFields(formData: FormData): AlbumFields | { error: string } {
  const title = textField(formData.get("title"));
  const eventDateRaw = textField(formData.get("eventDate"));
  const description = normalizeLineBreaks(textField(formData.get("description")));
  const photoAlbumUrl = textField(formData.get("photoAlbumUrl"));

  if (!title || !eventDateRaw || !photoAlbumUrl) {
    return { error: "Title, event date, and photo album link are required." };
  }
  if (title.length > ALBUM_FIELD_LIMITS.title) {
    return { error: `Keep the title to ${ALBUM_FIELD_LIMITS.title} characters or fewer.` };
  }
  if (description.length > ALBUM_FIELD_LIMITS.description) {
    return {
      error: `Keep the description to ${ALBUM_FIELD_LIMITS.description.toLocaleString("en-US")} characters or fewer.`,
    };
  }
  if (!isDateOnlyString(eventDateRaw)) {
    return { error: "Enter a valid event date." };
  }
  if (photoAlbumUrl.length > ALBUM_FIELD_LIMITS.photoAlbumUrl || !isSafeHttpUrl(photoAlbumUrl)) {
    return { error: "Enter a valid photo album link starting with https://" };
  }
  return { title, eventDate: new Date(`${eventDateRaw}T00:00:00.000Z`), description, photoAlbumUrl };
}

type UploadedCover = { url: string; metadataRemoved: boolean };

/**
 * Cover photos are uploaded to Vercel Blob at save time rather than linked
 * from PhotoPrism, whose thumbnail links break whenever its preview token
 * rotates (on restart/redeploy). The gallery never depends on PhotoPrism
 * staying up or a token staying stable.
 *
 * The photo is checked to really be a JPEG, PNG, WEBP or GIF and re-saved
 * without its metadata — a phone photo's EXIF can carry the GPS position of
 * the children in it — scaled down to COVER_MAX_SIDE (uploadValidation.ts).
 */
async function uploadCoverImage(formData: FormData): Promise<UploadedCover | { error: string } | null> {
  const file = formData.get("coverImage");
  if (!(file instanceof File) || file.size === 0) return null;

  let prepared;
  try {
    prepared = await prepareUpload(file, {
      label: "Cover image",
      allowed: IMAGE_MEDIA_TYPES,
      maxStoredSide: COVER_MAX_SIDE,
      requireMetadataRemoval: true,
    });
  } catch (error) {
    if (error instanceof UploadRejectedError) return { error: error.message };
    throw error;
  }

  try {
    const blob = await put(`album-covers/${crypto.randomUUID()}.${prepared.extension}`, Buffer.from(prepared.bytes), {
      access: "public",
      contentType: prepared.contentType,
    });
    return { url: blob.url, metadataRemoved: prepared.metadataRemoved };
  } catch (error) {
    console.error("[albums] cover upload to Blob storage failed", error);
    return { error: "The cover image couldn't be uploaded just now. Please try again in a minute." };
  }
}

function coverAuditValue(cover: UploadedCover) {
  return cover.metadataRemoved ? "Uploaded (photo details removed)" : "Uploaded (photo details NOT removed)";
}

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

export async function createAlbumAction(
  _prevState: AlbumActionState,
  formData: FormData
): Promise<AlbumActionState> {
  const session = await requireAlbumEditor();
  if (!session) return { error: "Not authorized." };

  const fields = readAlbumFields(formData);
  if ("error" in fields) return { error: fields.error };

  const cover = await uploadCoverImage(formData);
  if (cover && "error" in cover) return { error: cover.error };

  let albumId: string;
  try {
    const album = await prisma.photoAlbum.create({
      data: {
        title: fields.title,
        eventDate: fields.eventDate,
        description: fields.description || null,
        coverImageUrl: cover?.url ?? null,
        photoAlbumUrl: fields.photoAlbumUrl,
      },
    });
    albumId = album.id;
  } catch (error) {
    console.error("[albums] saving a new album failed", error);
    // The cover was uploaded for this album; with no album it would sit
    // public with nothing linking to it.
    await discardUnsavedUpload(cover?.url);
    return { error: "The album couldn't be saved. Please try again." };
  }

  await recordAudit(session, {
    action: "album.create",
    summary: `Created the photo album “${fields.title}”`,
    entityType: "PhotoAlbum",
    entityId: albumId,
    details: [
      { label: "Title", from: "—", to: fields.title },
      { label: "Event date", from: "—", to: auditDate(fields.eventDate) },
      { label: "Album link", from: "—", to: fields.photoAlbumUrl },
      ...(cover ? [{ label: "Cover image", from: "—", to: coverAuditValue(cover) }] : []),
    ],
  });
  // A good moment to retry any deletion that failed earlier (bounded, never throws).
  if (cover) await processPendingBlobDeletions();

  revalidatePath("/portal/admin/albums");
  revalidatePath("/gallery");
  redirect("/portal/admin/albums");
}

export async function updateAlbumAction(
  _prevState: AlbumActionState,
  formData: FormData
): Promise<AlbumActionState> {
  const session = await requireAlbumEditor();
  if (!session) return { error: "Not authorized." };

  const albumId = textField(formData.get("albumId"));
  if (!albumId) return { error: "Missing album id." };
  const fields = readAlbumFields(formData);
  if ("error" in fields) return { error: fields.error };

  // Uploaded before the transaction, never inside it: no row lock is held
  // while the photo is processed and sent to storage. Leaving the file input
  // blank keeps whatever cover image is already saved.
  const cover = await uploadCoverImage(formData);
  if (cover && "error" in cover) return { error: cover.error };

  // What the save found: no album at all, or the cover it replaced (if any).
  let saved: { found: false } | { found: true; replacedCoverUrl: string | null };
  try {
    saved = await prisma.$transaction(async (tx) => {
      // Lock the album first, then read it: a delete or another edit running
      // at the same time lands wholly before or after this one, so the cover
      // read here is exactly the one this save replaces — and the one to
      // delete from storage afterwards.
      await tx.$queryRaw`SELECT 1 FROM "PhotoAlbum" WHERE "id" = ${albumId} FOR UPDATE`;
      const before = await tx.photoAlbum.findUnique({
        where: { id: albumId },
        select: { title: true, eventDate: true, description: true, photoAlbumUrl: true, coverImageUrl: true },
      });
      if (!before) return { found: false as const };

      await tx.photoAlbum.update({
        where: { id: albumId },
        data: {
          title: fields.title,
          eventDate: fields.eventDate,
          description: fields.description || null,
          ...(cover ? { coverImageUrl: cover.url } : {}),
          photoAlbumUrl: fields.photoAlbumUrl,
        },
      });

      // In the transaction: replacing a cover deletes the old photo, so the
      // log entry and the change commit (or fail) together.
      await recordAuditInTransaction(tx, session, {
        action: "album.update",
        summary: `Edited the photo album “${fields.title}”`,
        entityType: "PhotoAlbum",
        entityId: albumId,
        details: [
          ...changedFields({
            Title: [before.title, fields.title],
            "Event date": [before.eventDate, fields.eventDate],
            // Compared with plain LF line breaks, so an older description saved
            // with CRLF doesn't show up as edited when only that changed.
            Description: [before.description && normalizeLineBreaks(before.description), fields.description || null],
            "Album link": [before.photoAlbumUrl, fields.photoAlbumUrl],
          }),
          // The old blob URL isn't worth keeping; that a new file replaced it is.
          ...(cover
            ? [{ label: "Cover image", from: before.coverImageUrl ? "Previous" : "—", to: coverAuditValue(cover) }]
            : []),
        ],
      });
      const replacedCoverUrl =
        cover && before.coverImageUrl && before.coverImageUrl !== cover.url ? before.coverImageUrl : null;
      return { found: true as const, replacedCoverUrl };
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    console.error("[albums] saving album changes failed", error);
    await discardUnsavedUpload(cover?.url);
    return { error: "The changes couldn't be saved. Please try again." };
  }

  if (!saved.found) {
    await discardUnsavedUpload(cover?.url);
    return { error: "This album no longer exists — someone may have just deleted it." };
  }

  // After the commit, so a cleanup failure can only ever leave a stray object
  // behind — never a row pointing at an image that's gone.
  if (saved.replacedCoverUrl) await deleteUploadedBlob(saved.replacedCoverUrl);
  else if (cover) await processPendingBlobDeletions();

  revalidatePath("/portal/admin/albums");
  revalidatePath("/gallery");
  redirect("/portal/admin/albums");
}

export type AlbumVisibilityResult = { ok: true } | { ok: false; error: string };

/**
 * Publishes or hides an album on the public gallery. Hiding only takes the
 * listing down: the cover photo stays reachable at its direct URL until the
 * album is deleted (see docs/security-operations.md).
 */
export async function toggleAlbumVisibilityAction(albumId: string, isVisible: boolean): Promise<AlbumVisibilityResult> {
  const session = await requireAlbumEditor();
  if (!session) return { ok: false, error: "Not authorized." };
  // Anyone can post anything to a Server Action; these are the only shapes accepted.
  if (typeof albumId !== "string" || !albumId || typeof isVisible !== "boolean") {
    return { ok: false, error: "That request wasn't valid. Reload the page and try again." };
  }

  const { count } = await prisma.photoAlbum.updateMany({ where: { id: albumId }, data: { isVisible } });
  if (count === 0) return { ok: false, error: "This album no longer exists — reload the page." };
  const album = await prisma.photoAlbum.findUnique({ where: { id: albumId }, select: { title: true } });

  await recordAudit(session, {
    action: "album.toggle",
    summary: `${isVisible ? "Published" : "Hid"} the photo album “${album?.title ?? albumId}” ${isVisible ? "to" : "from"} the public gallery`,
    entityType: "PhotoAlbum",
    entityId: albumId,
    details: [{ label: "Visible", from: isVisible ? "No" : "Yes", to: isVisible ? "Yes" : "No" }],
  });

  revalidatePath("/portal/admin/albums");
  revalidatePath("/gallery");
  return { ok: true };
}

export async function deleteAlbumAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const albumId = textField(formData.get("albumId"));
  if (!albumId) throw new Error("Missing album id.");

  const album = await prisma.$transaction(async (tx) => {
    // Same lock as updateAlbumAction, so an edit that's replacing the cover
    // right now finishes first and this deletes the cover it left.
    await tx.$queryRaw`SELECT 1 FROM "PhotoAlbum" WHERE "id" = ${albumId} FOR UPDATE`;
    const current = await tx.photoAlbum.findUnique({ where: { id: albumId } });
    // Already gone (a second click, or another admin): nothing left to do.
    if (!current) return null;
    await tx.photoAlbum.delete({ where: { id: albumId } });
    await recordAuditInTransaction(tx, session, {
      action: "album.delete",
      summary: `Deleted the photo album “${current.title}”`,
      entityType: "PhotoAlbum",
      entityId: albumId,
      details: [
        { label: "Title", from: current.title, to: "—" },
        { label: "Album link", from: current.photoAlbumUrl, to: "—" },
        ...(current.coverImageUrl ? [{ label: "Cover image", from: "Uploaded", to: "Deleted from storage" }] : []),
      ],
    });
    return current;
  }, TRANSACTION_OPTIONS);

  // The gallery entry and the image it pointed at both have to go. Deleting
  // only the row left the cover public at its original URL, which is the
  // opposite of what this button is usually pressed for. After the commit,
  // like every other cleanup.
  if (album) await deleteUploadedBlob(album.coverImageUrl);

  revalidatePath("/portal/admin/albums");
  revalidatePath("/gallery");
}
