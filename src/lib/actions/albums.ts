"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin, assertAlbumEditAccess } from "@/lib/authorize";

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
 * Cover photos used to be a pasted PhotoPrism thumbnail link, which broke
 * every time PhotoPrism's preview token rotated (on restart/redeploy). We
 * now upload the file to Vercel Blob at save time so the gallery page never
 * depends on PhotoPrism staying up or a token staying stable.
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

  await prisma.photoAlbum.create({
    data: {
      title,
      eventDate,
      description: description || null,
      coverImageUrl,
      photoAlbumUrl,
    },
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

  await prisma.photoAlbum.update({ where: { id: albumId }, data: { isVisible } });

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

  await prisma.photoAlbum.delete({ where: { id: albumId } });

  revalidatePath("/portal/admin/albums");
  revalidatePath("/gallery");
}
