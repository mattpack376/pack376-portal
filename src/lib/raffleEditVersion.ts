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
 * Only the fields the form can change are in it. Verifying or un-verifying a
 * payment doesn't change it, so an open Edit box stays usable through that;
 * a save that changes the amount or method still clears the Verified tick
 * (see updatePaymentAction).
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
