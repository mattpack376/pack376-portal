import { prisma } from "@/lib/prisma";
import { ALBUM_PHOTO_SIZES, type AlbumPhotoSize } from "@/lib/albumPhotoRules";

/**
 * Serves one event photo to the public album page (src/app/gallery/[albumId]).
 * The page only ever links here, never to the photo's storage address, so:
 *
 * - hiding the album, or deleting the photo, stops it loading at once
 *   (apart from caches — see below), where a storage link would keep working;
 * - there's no plain file address on the page to copy and pass around.
 *
 * The response asks search engines not to index the picture. It is never
 * kept by the CDN — every request comes back here and is checked again, so
 * Hide and Remove take effect at once — only by the viewer's own browser,
 * for five minutes. An album is at most a handful of small images, so this
 * costs little.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ photoId: string; size: string }> }) {
  const { photoId, size } = await params;
  if (!(ALBUM_PHOTO_SIZES as readonly string[]).includes(size)) return notFound();

  const photo = await prisma.albumPhoto.findUnique({
    where: { id: photoId },
    select: { imageUrl: true, thumbUrl: true, album: { select: { isVisible: true } } },
  });
  if (!photo || !photo.album.isVisible) return notFound();

  const source = (size as AlbumPhotoSize) === "full" ? photo.imageUrl : photo.thumbUrl;
  let upstream: Response;
  try {
    upstream = await fetch(source, { cache: "no-store" });
  } catch (error) {
    console.error("[album photos] couldn't fetch a photo from Blob storage", error);
    return new Response("Photo unavailable.", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  if (!upstream.ok || !upstream.body) {
    console.error(`[album photos] Blob storage answered ${upstream.status} for photo ${photoId} (${size})`);
    return new Response("Photo unavailable.", { status: 502, headers: { "Cache-Control": "no-store" } });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": "inline",
      "X-Robots-Tag": "noindex, noimageindex",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function notFound() {
  // Not cached either, so un-hiding an album brings its photos straight back.
  return new Response("Not found.", { status: 404, headers: { "Cache-Control": "no-store" } });
}
