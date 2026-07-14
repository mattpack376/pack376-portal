import "server-only";
import { randomBytes } from "node:crypto";

/** Long, unguessable capability token for a photo-consent link — see PhotoConsent in schema.prisma for why it's stored as plaintext rather than hashed. */
export function generatePhotoConsentToken() {
  return randomBytes(32).toString("base64url");
}
