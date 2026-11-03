/**
 * Limits for event photos (AlbumPhoto), shared by the upload action and the
 * admin page's uploader. Kept out of the "use server" actions file, which
 * can only export actions.
 */

/** Most photos one album holds. The pack posts a handful per event. */
export const MAX_PHOTOS_PER_ALBUM = 10;

/**
 * The browser shrinks a photo to this before sending it, so a full-size
 * phone photo fits under the hosting platform's request size limit (about
 * 4.5MB). The server then makes its own, smaller copies.
 */
export const UPLOAD_SHRINK_SIDE = 2400;

/** Long side, in pixels, of the full-screen copy the public page shows. */
export const ALBUM_PHOTO_FULL_SIDE = 1600;
/** Long side, in pixels, of the small copy in the photo grid. */
export const ALBUM_PHOTO_THUMB_SIDE = 640;
/** Photos smaller than this on their short side are refused as too small to show well. */
export const ALBUM_PHOTO_MIN_SIDE = 300;

export const ALBUM_PHOTO_SIZES = ["full", "thumb"] as const;
export type AlbumPhotoSize = (typeof ALBUM_PHOTO_SIZES)[number];

/** Where the public page loads a photo from. Never the storage address itself. */
export function albumPhotoSrc(photoId: string, size: AlbumPhotoSize) {
  return `/album-photos/${encodeURIComponent(photoId)}/${size}`;
}
