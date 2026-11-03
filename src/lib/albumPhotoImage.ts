import "server-only";
import {
  UploadRejectedError,
  loadSharp,
  prepareUploadBytes,
  type ImageMediaType,
  type SharpConstructor,
} from "@/lib/uploadValidation";
import { PHOTO_WATERMARK_PNG } from "@/lib/photoWatermark";
import { ALBUM_PHOTO_FULL_SIDE, ALBUM_PHOTO_MIN_SIDE, ALBUM_PHOTO_THUMB_SIDE } from "@/lib/albumPhotoRules";

/** Event photos are still pictures: no GIFs (animations) and no PDFs. */
const PHOTO_TYPES: readonly ImageMediaType[] = ["image/jpeg", "image/png", "image/webp"];

export type ProcessedAlbumPhoto = {
  full: Buffer;
  thumb: Buffer;
  /** Size of the full copy, in pixels. */
  width: number;
  height: number;
};

/**
 * Turns one uploaded event photo into the two copies the site stores: a
 * full-screen one (ALBUM_PHOTO_FULL_SIDE) and a grid one
 * (ALBUM_PHOTO_THUMB_SIDE), both JPEGs with the pack watermark in the
 * bottom-right corner.
 *
 * The upload goes through the same checks as a cover photo first
 * (uploadValidation.ts): it has to really be a JPEG, PNG or WEBP, and it is
 * re-saved upright with all its metadata removed — a phone photo's EXIF can
 * carry the GPS position of the children in it. No full-size original is
 * kept anywhere, so the biggest copy that exists is the watermarked one.
 *
 * Needs the image library (sharp) for the watermark; without it every photo
 * is refused rather than stored without one. Throws UploadRejectedError with
 * a message to show the person uploading.
 */
export async function processAlbumPhoto(file: File): Promise<ProcessedAlbumPhoto> {
  const sharp = await loadSharp();
  // Size is checked inside prepareUploadBytes before anything is decoded.
  const bytes = new Uint8Array(await file.arrayBuffer());
  return processAlbumPhotoBytes(bytes, file.type, sharp);
}

/** processAlbumPhoto once the bytes are in hand; separate so tests can pass their own sharp (or none). */
export async function processAlbumPhotoBytes(
  bytes: Uint8Array,
  claimedType: string,
  sharp: SharpConstructor | null,
): Promise<ProcessedAlbumPhoto> {
  if (!sharp) {
    throw new UploadRejectedError("Photos can't be processed on the server right now. Please try again later.");
  }
  const prepared = await prepareUploadBytes(
    bytes,
    claimedType,
    {
      label: "Photo",
      allowed: PHOTO_TYPES,
      maxStoredSide: ALBUM_PHOTO_FULL_SIDE,
      requireMetadataRemoval: true,
    },
    sharp,
  );

  try {
    const full = await renderCopy(sharp, prepared.bytes, ALBUM_PHOTO_FULL_SIDE, 82);
    if (Math.min(full.width, full.height) < ALBUM_PHOTO_MIN_SIDE) {
      throw new UploadRejectedError(
        `That photo is only ${full.width} × ${full.height} pixels, too small to show well. Choose the original photo instead.`,
      );
    }
    const thumb = await renderCopy(sharp, prepared.bytes, ALBUM_PHOTO_THUMB_SIDE, 78);
    return { full: full.data, thumb: thumb.data, width: full.width, height: full.height };
  } catch (error) {
    if (error instanceof UploadRejectedError) throw error;
    console.error("[album photos] couldn't make the watermarked copies of a photo", error);
    throw new UploadRejectedError("That photo couldn't be processed. Save it again as a JPEG and try once more.");
  }
}

/** One watermarked JPEG copy, no bigger than maxSide on either side. */
async function renderCopy(sharp: SharpConstructor, input: Uint8Array, maxSide: number, quality: number) {
  // Decoded to raw pixels first, so the final size is known before the mark is placed.
  const base = await sharp(input)
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    // A see-through PNG would otherwise come out with a black background as a JPEG.
    .flatten({ background: "#ffffff" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = base.info;

  const margin = Math.max(4, Math.round(width * 0.02));
  // About a fifth of the photo's width, and never wider than the photo itself.
  const markWidth = Math.max(1, Math.min(Math.round(width * 0.22), width - 2 * margin));
  const mark = await sharp(PHOTO_WATERMARK_PNG).resize({ width: markWidth }).png().toBuffer({ resolveWithObject: true });
  const left = Math.max(0, width - mark.info.width - margin);
  const top = Math.max(0, height - mark.info.height - margin);

  const data = await sharp(base.data, { raw: { width, height, channels } })
    .composite([{ input: mark.data, left, top }])
    // Default output keeps no metadata.
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
  return { data, width, height };
}
