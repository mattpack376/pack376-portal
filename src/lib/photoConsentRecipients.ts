import "server-only";
import { isDeliverableAddress } from "@/lib/email";

/**
 * Where a scout's photo-consent link is emailed: the first parent contact on
 * file (oldest first, as listed) whose email is one plain address. The
 * Photo Consent page's Email Link button and Email All tally and both send
 * actions all use this, so what the page offers is what gets sent.
 */
export function consentLinkRecipient(parents: { email: string | null }[]): string | null {
  for (const parent of parents) {
    const email = parent.email?.trim();
    if (email && isDeliverableAddress(email)) return email;
  }
  return null;
}

/**
 * The parent email on file for this scout that `requested` names (matched
 * without regard to case or surrounding spaces), as stored — or null when no
 * parent of the scout has that address, or it isn't one plain address.
 */
export function parentEmailOnFile(parents: { email: string | null }[], requested: string): string | null {
  const wanted = requested.trim().toLowerCase();
  if (!wanted) return null;
  for (const parent of parents) {
    const email = parent.email?.trim();
    if (email && email.toLowerCase() === wanted && isDeliverableAddress(email)) return email;
  }
  return null;
}
