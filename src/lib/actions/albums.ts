"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin, assertAlbumEditAccess } from "@/lib/authorize";
import { recordAudit, changedFields, auditDate } from "@/lib/audit";
import { deleteUploadedBlob } from "@/lib/blobCleanup";

export type AlbumActionState = { error?: string };

function readAlbumFields(formData: FormData) {
  const title = String(formData.get("title") || "").trim();
  const eventDateRaw = String(formData.get("eventDate") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const photoAlbumUrl = String(formData.get("photoAlbumUrl") || "").trim();
  return { title, eventDateRaw, description, photoAlbumUrl };
}

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

const MAX_COVER_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_COVER_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Cover photos are uploaded to Vercel Blob at save time rather than linked
 * from PhotoPrism, whose thumbnail links break whenever its preview token
 * rotates (on restart/redeploy). The gallery never depends on PhotoPrism
 * staying up or a token staying stable.
 */
async function uploadCoverImage(file: File): Promise<{ url?: string; error?: string }> {
  const extension = ALLOWED_COVER_IMAGE_TYPES[file.type];
  if (!extension) {
    return { error: "Cover image must be a JPEG, PNG, WEBP, or GIF." };
  }
  if (file.size > MAX_COVER_IMAGE_BYTES) {
    return { error: "Cover image must be 8MB or smaller." };
  }

  const blob = await put(`album-covers/${crypto.randomUUID()}.${extension}`, file, {
    access: "public",
    contentType: file.type,
  });
  return { url: blob.url };
}

export async function createAlbumAction(
  _prevState: AlbumActionState,
  formData: FormData
): Promise<AlbumActionState> {
  const session = await getSession();
  if (!session) return { error: "Not authorized." };
  try {
    assertAlbumEditAccess(session);
  } catch {
    return { error: "Not authorized." };
  }

  const { title, eventDateRaw, description, photoAlbumUrl } = readAlbumFields(formData);
  if (!title || !eventDateRaw || !photoAlbumUrl) {
    return { error: "Title, event date, and photo album link are required." };
  }
  const eventDate = new Date(eventDateRaw);
  if (Number.isNaN(eventDate.getTime())) {
    return { error: "Enter a valid event date." };
  }
  if (!isSafeHttpUrl(photoAlbumUrl)) {
    return { error: "Enter a valid photo album link starting with https://" };
  }

  let coverImageUrl: string | null = null;
  const coverImage = formData.get("coverImage");
  if (coverImage instanceof File && coverImage.size > 0) {
    const uploaded = await uploadCoverImage(coverImage);
    if (uploaded.error) return { error: uploaded.error };
    coverImageUrl = uploaded.url ?? null;
  }

  const album = await prisma.photoAlbum.create({
    data: {
      title,
      eventDate,
      description: description || null,
      coverImageUrl,
      photoAlbumUrl,
    },
  });

  await recordAudit(session, {
    action: "album.create",
    summary: `Created the photo album “${title}”`,
    entityType: "PhotoAlbum",
    entityId: album.id,
    details: [
      { label: "Title", from: "—", to: title },
      { label: "Event date", from: "—", to: auditDate(eventDate) },
      { label: "Album link", from: "—", to: photoAlbumUrl },
      ...(coverImageUrl ? [{ label: "Cover image", from: "—", to: "Uploaded" }] : []),
    ],
  });

  revalidatePath("/portal/admin/albums");
  revalidatePath("/gallery");
  redirect("/portal/admin/albums");
}

export async function updateAlbumAction(
  _prevState: AlbumActionState,
  formData: FormData
): Promise<AlbumActionState> {
  const session = await getSession();
  if (!session) return { error: "Not authorized." };
  try {
    assertAlbumEditAccess(session);
  } catch {
    return { error: "Not authorized." };
  }

  const albumId = String(formData.get("albumId") || "");
  const { title, eventDateRaw, description, photoAlbumUrl } = readAlbumFields(formData);
  if (!albumId) return { error: "Missing album id." };
  if (!title || !eventDateRaw || !photoAlbumUrl) {
    return { error: "Title, event date, and photo album link are required." };
  }
  const eventDate = new Date(eventDateRaw);
  if (Number.isNaN(eventDate.getTime())) {
    return { error: "Enter a valid event date." };
  }
  if (!isSafeHttpUrl(photoAlbumUrl)) {
    return { error: "Enter a valid photo album link starting with https://" };
  }

  // Only touch coverImageUrl when a new file was uploaded, so leaving the
  // file input blank keeps whatever cover image is already saved.
  let coverImageUrl: string | undefined;
  const coverImage = formData.get("coverImage");
  if (coverImage instanceof File && coverImage.size > 0) {
    const uploaded = await uploadCoverImage(coverImage);
    if (uploaded.error) return { error: uploaded.error };
    coverImageUrl = uploaded.url;
  }

  const before = await prisma.photoAlbum.findUnique({
    where: { id: albumId },
    // coverImageUrl so the object the new upload displaces can be deleted
    // from Blob storage below, instead of being left public forever.
    select: { title: true, eventDate: true, description: true, photoAlbumUrl: true, coverImageUrl: true },
  });

  await prisma.photoAlbum.update({
    where: { id: albumId },
    data: {
      title,
      eventDate,
      description: description || null,
      ...(coverImageUrl !== undefined ? { coverImageUrl } : {}),
      photoAlbumUrl,
    },
  });

  // After the row is updated, so a cleanup failure can only ever leave a
  // stray object behind — never a row pointing at an image that's gone.
  if (coverImageUrl !== undefined && before?.coverImageUrl && before.coverImageUrl !== coverImageUrl) {
    await deleteUploadedBlob(before.coverImageUrl);
  }

  await recordAudit(session, {
    action: "album.update",
    summary: `Edited the photo album “${title}”`,
    entityType: "PhotoAlbum",
    entityId: albumId,
    details: [
      ...changedFields({
        Title: [before?.title, title],
        "Event date": [before?.eventDate, eventDate],
        Description: [before?.description, description || null],
        "Album link": [before?.photoAlbumUrl, photoAlbumUrl],
      }),
      // The old blob URL isn't worth keeping; that a new file replaced it is.
      ...(coverImageUrl !== undefined ? [{ label: "Cover image", from: "Previous", to: "Replaced" }] : []),
    ],
  });

  revalidatePath("/portal/admin/albums");
  revalidatePath("/gallery");
  redirect("/portal/admin/albums");
}

export async function toggleAlbumVisibilityAction(albumId: string, isVisible: boolean) {
  const session = await getSession();
  if (!session) return { ok: false as const };
  try {
    assertAlbumEditAccess(session);
  } catch {
    return { ok: false as const };
  }

  const album = await prisma.photoAlbum.update({ where: { id: albumId }, data: { isVisible } });

  await recordAudit(session, {
    action: "album.toggle",
    summary: `${isVisible ? "Published" : "Hid"} the photo album “${album.title}” ${isVisible ? "to" : "from"} the public gallery`,
    entityType: "PhotoAlbum",
    entityId: albumId,
    details: [{ label: "Visible", from: isVisible ? "No" : "Yes", to: isVisible ? "Yes" : "No" }],
  });

  revalidatePath("/portal/admin/albums");
  revalidatePath("/gallery");
  return { ok: true as const };
}

export async function deleteAlbumAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const albumId = String(formData.get("albumId") || "");
  if (!albumId) throw new Error("Missing album id.");

  const album = await prisma.photoAlbum.delete({ where: { id: albumId } });

  // The gallery entry and the image it pointed at both have to go. Deleting
  // only the row left the cover public at its original URL, which is the
  // opposite of what this button is usually pressed for.
  await deleteUploadedBlob(album.coverImageUrl);

  await recordAudit(session, {
    action: "album.delete",
    summary: `Deleted the photo album “${album.title}”`,
    entityType: "PhotoAlbum",
    entityId: albumId,
    details: [
      { label: "Title", from: album.title, to: "—" },
      { label: "Album link", from: album.photoAlbumUrl, to: "—" },
      ...(album.coverImageUrl ? [{ label: "Cover image", from: "Uploaded", to: "Deleted from storage" }] : []),
    ],
  });

  revalidatePath("/portal/admin/albums");
  revalidatePath("/gallery");
}
