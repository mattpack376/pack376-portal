/**
 * Paid / partial / unpaid status for anything families owe money on — dues,
 * event registrations, guest groups, trip registrations.
 *
 * The status colors are their own classes (see globals.css) rather than
 * borrowed role badges, so restyling a role badge can't recolor every unpaid
 * amount in the portal.
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

/**
 * Row color for a list of people who owe money — red while anything is
 * outstanding, green once it's settled, and nothing at all when no fee has
 * been set, since "Fee Not Set" is not the same as owing nothing and
 * shouldn't read as paid. Applied to a table row or to a collapsed group's
 * summary line (CollapsibleGroup's labelClassName), so a list scans by color
 * without reading every amount.
 */
export function paymentRowClass(remainingCents: number | null, paidCents: number): string | undefined {
  const { cls } = paymentStatus(remainingCents, paidCents);
  if (cls === "badge-pending") return undefined;
  return cls === "badge-paid" ? "status-paid" : "status-owing";
}

/** Label alone, for CSV exports and summary lines that have no badge to color. */
export function paymentStatusLabel(remainingCents: number | null, paidCents: number) {
  return paymentStatus(remainingCents, paidCents).label;
}
