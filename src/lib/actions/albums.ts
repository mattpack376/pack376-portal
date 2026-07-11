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
  const googlePhotosUrl = String(formData.get("googlePhotosUrl") || "").trim();
  return { title, eventDateRaw, description, coverImageUrl, googlePhotosUrl };
}

// Google Photos share pages (photos.app.goo.gl/... or photos.google.com/share/...)
// are HTML viewer pages, not image files — they can't be hotlinked as a cover
// photo. Catch this at save time instead of silently storing a broken link.
const GOOGLE_PHOTOS_SHARE_LINK = /photos\.(app\.goo\.gl|google\.com\/share)/i;

function validateCoverImageUrl(coverImageUrl: string): string | null {
  if (coverImageUrl && GOOGLE_PHOTOS_SHARE_LINK.test(coverImageUrl)) {
    return "That's a Google Photos share link, not a direct image link — Google Photos share pages can't be used as a cover photo. Open the shared album, right-click a photo, choose \"Open image in new tab,\" and paste that image URL here instead.";
  }
  return null;
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

  const { title, eventDateRaw, description, coverImageUrl, googlePhotosUrl } = readAlbumFields(formData);
  if (!title || !eventDateRaw || !googlePhotosUrl) {
    return { error: "Title, event date, and Google Photos link are required." };
  }
  const eventDate = new Date(eventDateRaw);
  if (Number.isNaN(eventDate.getTime())) {
    return { error: "Enter a valid event date." };
  }
  const coverImageError = validateCoverImageUrl(coverImageUrl);
  if (coverImageError) return { error: coverImageError };

  await prisma.photoAlbum.create({
    data: {
      title,
      eventDate,
      description: description || null,
      coverImageUrl: coverImageUrl || null,
      googlePhotosUrl,
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
  const { title, eventDateRaw, description, coverImageUrl, googlePhotosUrl } = readAlbumFields(formData);
  if (!albumId) return { error: "Missing album id." };
  if (!title || !eventDateRaw || !googlePhotosUrl) {
    return { error: "Title, event date, and Google Photos link are required." };
  }
  const eventDate = new Date(eventDateRaw);
  if (Number.isNaN(eventDate.getTime())) {
    return { error: "Enter a valid event date." };
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
      googlePhotosUrl,
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
