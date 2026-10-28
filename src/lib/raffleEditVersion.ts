import "server-only";
import { createHash } from "node:crypto";

/*
 * A short fingerprint of the values an Edit form was filled in with. The form
 * sends it back with the save, and the save is refused if the row no longer
 * matches it. Without that, a form opened before someone else's change would
 * quietly put the old values back: one Admin corrects a payment to $20 Zelle
 * and verifies it, and another's Edit box, still showing $10 cash, saves a
 * note and undoes all of it (security review 2026-10-27).
 *
 * The raffle's own settings form (Edit Raffle) works the same way: an Admin
 * who saves a notes fix from a page loaded before another Admin raised the
 * winner's share to 60% would otherwise put it back to 50%, and the prize
 * would then be worked out from 50% (integration review 2026-10-27).
 *
 * Only the fields the form can change are in it. Verifying or un-verifying a
 * payment doesn't change it, so an open Edit box stays usable through that;
 * a save that changes the amount or method still clears the Verified tick
 * (see updatePaymentAction). Likewise selling boxes, taking payments or
 * recording the winner leaves an open Edit Raffle form usable.
 */

function fingerprint(values: unknown[]) {
  return createHash("sha256").update(JSON.stringify(values)).digest("base64url").slice(0, 22);
}

/** What updatePaymentAction's form edits. */
export function paymentEditVersion(payment: {
  entryId: string | null;
  amountCents: number;
  method: string;
  payerName: string | null;
  receivedOn: Date | null;
  note: string | null;
}) {
  return fingerprint([
    "payment",
    payment.entryId,
    payment.amountCents,
    payment.method,
    payment.payerName,
    payment.receivedOn ? payment.receivedOn.toISOString() : null,
    payment.note,
  ]);
}

/** What updateEntryAction's form edits. */
export function entryEditVersion(entry: { name: string; notes: string | null }) {
  return fingerprint(["entry", entry.name, entry.notes]);
}

/** What updateRaffleAction's form (Edit Raffle, under Raffle Settings) edits. */
export function raffleTermsVersion(raffle: {
  name: string;
  boxCount: number;
  priceCents: number;
  prizePercent: number;
  drawingDate: Date | null;
  notes: string | null;
}) {
  return fingerprint([
    "raffle",
    raffle.name,
    raffle.boxCount,
    raffle.priceCents,
    raffle.prizePercent,
    raffle.drawingDate ? raffle.drawingDate.toISOString() : null,
    raffle.notes,
  ]);
}
