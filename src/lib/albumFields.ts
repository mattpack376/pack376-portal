import { MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from "@/lib/formValues";

/**
 * How long each photo album field may be. src/lib/actions/albums.ts enforces
 * these on every save; the New Album and Edit Album forms pass the same
 * numbers to the browser (maxLength), so a too-long entry is stopped while
 * typing instead of being refused after the form has already cleared. Kept
 * out of albums.ts because a "use server" file can only export actions.
 */
export const ALBUM_FIELD_LIMITS = {
  title: MAX_NAME_LENGTH,
  description: MAX_NOTE_LENGTH,
  /** Real share links are well under 200 characters. */
  photoAlbumUrl: 2048,
} as const;

/**
 * Browsers send a textarea's line breaks as CRLF but count each as one
 * character against maxLength, so descriptions are measured and stored with
 * plain LF line breaks.
 */
export function normalizeLineBreaks(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}
