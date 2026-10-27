import "server-only";
import { randomBytes } from "node:crypto";

/** Long, unguessable capability token for a photo-consent link — see PhotoConsent in schema.prisma for why it's stored as plaintext rather than hashed. */
export function generatePhotoConsentToken() {
  return randomBytes(32).toString("base64url");
}

/**
 * Whether a token from a link or a form could be one generatePhotoConsentToken
 * made (base64url, 43 characters for 32 bytes; a little leeway either side),
 * so anything else is turned away before it reaches the database.
 */
export function isPhotoConsentTokenShape(token: string) {
  return /^[A-Za-z0-9_-]{20,128}$/.test(token);
}
