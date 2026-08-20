/**
 * Paid / partial / unpaid status for anything families owe money on — dues,
 * event registrations, guest groups, trip registrations.
 *
 * This lived as a copy-pasted ternary in nine pages and three CSV routes,
 * each reaching for a role badge to color it (Partial as .badge-junior,
 * Unpaid as .badge-photographer). Restyling the Junior Admin or Photographer
 * badge would have silently restyled every unpaid amount in the portal, so
 * the status colors are now their own classes — see globals.css.
 *
 * `remainingCents` is null when no fee has been set (see duesData.ts, where
 * it is null exactly when dueCents is), which is a different thing from
 * owing nothing.
 */
export type PaymentStatus = { label: string; cls: string };

export function paymentStatus(remainingCents: number | null, paidCents: number): PaymentStatus {
  if (remainingCents === null) return { label: "Fee Not Set", cls: "badge-pending" };
  if (remainingCents <= 0) {
    return { label: remainingCents < 0 ? "Overpaid" : "Paid in Full", cls: "badge-paid" };
  }
  if (paidCents > 0) return { label: "Partial", cls: "badge-partial" };
  return { label: "Unpaid", cls: "badge-unpaid" };
}

/** Label alone, for CSV exports and summary lines that have no badge to color. */
export function paymentStatusLabel(remainingCents: number | null, paidCents: number) {
  return paymentStatus(remainingCents, paidCents).label;
}
