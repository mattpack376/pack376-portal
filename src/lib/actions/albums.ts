"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin, assertAlbumEditAccess } from "@/lib/authorize";

export type AlbumActionState = { error?: string };

function readAlbumFields(formData: FormData) {
  const title = String(formData.get("title") || "").trim();
  const eventDateRaw = String(formData.get("eventDate") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const coverImageUrl = String(formData.get("coverImageUrl") || "").trim();
  const photoAlbumUrl = String(formData.get("photoAlbumUrl") || "").trim();
  return { title, eventDateRaw, description, coverImageUrl, photoAlbumUrl };
}

// Album share pages (Google Photos' photos.app.goo.gl/... and photos.google.com/share/...,
// or a PhotoPrism share link's /s/... path) are HTML viewer pages, not image files —
// they can't be hotlinked as a cover photo. Catch this at save time instead of
// silently storing a broken link.
const ALBUM_SHARE_LINK = /photos\.(app\.goo\.gl|google\.com\/share)|\/s\/[\w-]+\/?$/i;

function validateCoverImageUrl(coverImageUrl: string): string | null {
  if (coverImageUrl && ALBUM_SHARE_LINK.test(coverImageUrl)) {
    return "That looks like an album share link, not a direct image link — share pages can't be used as a cover photo. Open the shared album, right-click a photo, choose \"Open image in new tab,\" and paste that image URL here instead.";
  }
  return null;
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

  const { title, eventDateRaw, description, coverImageUrl, photoAlbumUrl } = readAlbumFields(formData);
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
  if (coverImageUrl && !isSafeHttpUrl(coverImageUrl)) {
    return { error: "Enter a valid cover image link starting with https://" };
  }
  const coverImageError = validateCoverImageUrl(coverImageUrl);
  if (coverImageError) return { error: coverImageError };

  await prisma.photoAlbum.create({
    data: {
      title,
      eventDate,
      description: description || null,
      coverImageUrl: coverImageUrl || null,
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
  const { title, eventDateRaw, description, coverImageUrl, photoAlbumUrl } = readAlbumFields(formData);
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
  if (coverImageUrl && !isSafeHttpUrl(coverImageUrl)) {
    return { error: "Enter a valid cover image link starting with https://" };
  }
  const coverImageError = validateCoverImageUrl(coverImageUrl);
  if (coverImageError) return { error: coverImageError };

  await prisma.photoAlbum.update({
    where: { id: albumId },
    data: {
      title,
      eventDate,
      description: description || null,
      coverImageUrl: coverImageUrl || null,
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
