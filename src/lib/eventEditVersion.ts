import "server-only";
import { createHash } from "node:crypto";

/*
 * A short fingerprint of the values an event money form was filled in with
 * (the same idea as raffleEditVersion.ts). The form sends it back with the
 * save, and the save is refused if the row no longer matches it. Without
 * that, a page opened before another Admin's change would quietly put the
 * old values back: one Admin gives a guest group a discount, and another,
 * fixing the family's name from a page loaded earlier, resends the old
 * amount owed and undoes it.
 *
 * Only the fields the form can change are in it, so recording a payment
 * against the group or registration leaves an open form usable.
 */

function fingerprint(values: unknown[]) {
  return createHash("sha256").update(JSON.stringify(values)).digest("base64url").slice(0, 22);
}

/** What updateGuestGroupAction's form edits. */
export function guestGroupEditVersion(group: {
  familyName: string;
  adultCount: number;
  childCount: number;
  amountOwedCents: number;
  guestOfScoutId: string | null;
  guestOfUserId: string | null;
}) {
  return fingerprint([
    "guestGroup",
    group.familyName,
    group.adultCount,
    group.childCount,
    group.amountOwedCents,
    group.guestOfScoutId,
    group.guestOfUserId,
  ]);
}

/** What updateRegistrationAmountAction's form edits. */
export function registrationEditVersion(registration: { amountOwedCents: number }) {
  return fingerprint(["registration", registration.amountOwedCents]);
}
