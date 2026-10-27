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
 * What the Photo Consent page shows in place of the Email Link button when
 * consentLinkRecipient found no address to use: either no parent email is on
 * file, or what is on file can't be emailed (a list, a name with the address,
 * a typo), which someone needs to fix rather than think is missing.
 */
export function noConsentRecipientNote(parents: { email: string | null }[]): string {
  return parents.some((parent) => parent.email?.trim())
    ? "The parent email on file isn't a single valid address, so the link can't be emailed. Copy the link above instead, and have the address corrected in Parent Contacts."
    : "No parent email on file — copy the link above instead.";
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
