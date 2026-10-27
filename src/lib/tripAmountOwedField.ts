import { dollarsToCents } from "@/lib/formValues";

/*
 * The admin edit form's "Amount Owed" field and the paying count beside it
 * (TripRegistrationCountFields). Plain functions so the rule is testable
 * without a browser.
 *
 * The amount used to be refilled with paying count × today's price on every
 * change to the count. That quietly repriced a family: one charged the
 * early-bird rate went to the regular rate when a count was corrected, and on
 * a trip whose price is still TBD — today's "price" being the $0 placeholder —
 * an amount an admin had typed went to $0.00, which then reads as paid in
 * full. What a family was charged is kept unless an admin changes it, so the
 * amount now only moves with the count while it still is count × today's
 * price (a total nobody has set by hand), and never while the price is TBD.
 */

/** The field's text as a dollar amount, e.g. "90.00". */
export function amountFieldText(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * True while the amount reads as `payingCount` × today's price — the case
 * where changing the count changes the amount with it. Never while the price
 * is TBD, and never for a blank amount (a registration waiting for a price).
 */
export function amountFollowsCount(amount: string, payingCount: number, pricePerPersonCents: number, priceTbd: boolean): boolean {
  if (priceTbd) return false;
  const cents = dollarsToCents(amount);
  return cents !== null && cents === payingCount * pricePerPersonCents;
}

/**
 * The Amount Owed field after the paying count goes from `previousCount` to
 * `nextCount`: the new count × today's price if the amount was following the
 * count (see amountFollowsCount), otherwise exactly as it was.
 */
export function amountAfterCountChange({
  amount,
  previousCount,
  nextCount,
  pricePerPersonCents,
  priceTbd,
}: {
  amount: string;
  previousCount: number;
  nextCount: number;
  pricePerPersonCents: number;
  priceTbd: boolean;
}): string {
  return amountFollowsCount(amount, previousCount, pricePerPersonCents, priceTbd)
    ? amountFieldText(nextCount * pricePerPersonCents)
    : amount;
}
