/**
 * How an uploaded event or trip flyer can be shown, decided from its URL.
 * The upload form takes images and PDFs (src/lib/flyerUpload.ts), and only
 * images may go through next/image: the optimizer can't decode a PDF, and it
 * only accepts the pack's own Blob store under the flyer prefixes
 * (next.config.ts). Anything it wouldn't take is shown as a link instead.
 *
 * Decided from the parsed URL's path, not the whole string, so a query string
 * or fragment ("…/flyer.pdf?download=1", "…/flyer.png#.pdf") can't change the
 * answer, and case doesn't matter (".PDF").
 *
 * Pure — no "server-only" — so it can be unit-tested and used by any component.
 */

/**
 * The pack's Blob store and the folders flyers are uploaded under: exactly
 * what next.config.ts lets the image optimizer fetch for a flyer. Duplicated
 * from there (and from blobCleanup.ts) because next.config.ts is compiled on
 * its own, outside the app's module graph. Keep the three in sync by hand.
 */
const BLOB_HOSTNAME = "jyclzu7uphezevn7.public.blob.vercel-storage.com";
const FLYER_PREFIXES = ["/event-flyers/", "/trip-flyers/"];
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

/**
 * - "image": an image on the pack's store — shown as an enlargeable picture.
 * - "pdf": a PDF anywhere — a link, labeled as a PDF.
 * - "link": any other web address — a plain link, never the image optimizer.
 */
export type FlyerDisplay = "image" | "pdf" | "link";

/** Null for no flyer, or for something that isn't an http(s) URL at all (which is never made into a link). */
export function flyerDisplay(url: string | null | undefined): FlyerDisplay | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  // Extensions in any case; the folder exactly as next.config.ts matches it.
  const path = parsed.pathname.toLowerCase();
  if (path.endsWith(".pdf")) return "pdf";
  const optimizable =
    parsed.protocol === "https:" &&
    parsed.hostname === BLOB_HOSTNAME &&
    FLYER_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix)) &&
    IMAGE_EXTENSIONS.some((extension) => path.endsWith(extension));
  return optimizable ? "image" : "link";
}
