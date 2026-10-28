import "server-only";
import { createHash } from "node:crypto";

/*
 * Short fingerprints of what an event admin page's edit forms were filled in
 * with — the same idea as raffleEditVersion.ts. The form sends its
 * fingerprint back with the save, and the save is refused if what's stored no
 * longer matches it. Without that, a form opened before someone else's
 * change quietly put the old values back (review 2026-10-27):
 *
 *  - Price Structure: one Admin posts the Cyclones price; another, whose form
 *    still has "TBD" ticked and $0.00 filled in, changes only the RSVP
 *    deadline — and the event is back to TBD at $0, with every family after
 *    that saved as owing nothing yet. A form loaded before a price change
 *    put the old price back the same way.
 *  - A registration: one Admin enters a family's discount; another's edit
 *    form, still showing the old Amount Owed, fixes a phone number and puts
 *    the old amount back.
 *
 * Only the fields each form edits are in its fingerprint, so an unrelated
 * change (a payment recorded, the event's title edited) leaves an open form
 * usable.
 */

function fingerprint(values: unknown[]) {
  return createHash("sha256").update(JSON.stringify(values)).digest("base64url").slice(0, 22);
}

const dateText = (date: Date | null) => (date ? date.toISOString() : null);

/** What the Price Structure form edits (updateTripPricingAction). */
export function tripPricingVersion(trip: {
  priceTbd: boolean;
  regularPriceCents: number;
  earlyBirdPriceCents: number | null;
  earlyBirdDeadline: Date | null;
  rsvpDeadline: Date | null;
  freeAgeAndUnder: number | null;
}) {
  return fingerprint([
    "tripPricing",
    trip.priceTbd,
    trip.regularPriceCents,
    trip.earlyBirdPriceCents,
    dateText(trip.earlyBirdDeadline),
    dateText(trip.rsvpDeadline),
    trip.freeAgeAndUnder,
  ]);
}

/**
 * What a registration's edit form edits (updateTripRegistrationAction),
 * including whether its amount is still waiting for the price — so posting
 * the price, or the Charge button, makes a form loaded before it out of date.
 */
export function tripRegistrationEditVersion(registration: {
  familyName: string;
  contactEmail: string;
  contactPhone: string | null;
  guestOfName: string;
  affiliation: string;
  payingCount: number;
  freeCount: number;
  amountOwedCents: number;
  owedPending: boolean;
}) {
  return fingerprint([
    "tripRegistration",
    registration.familyName,
    registration.contactEmail,
    registration.contactPhone,
    registration.guestOfName,
    registration.affiliation,
    registration.payingCount,
    registration.freeCount,
    registration.amountOwedCents,
    registration.owedPending,
  ]);
}
