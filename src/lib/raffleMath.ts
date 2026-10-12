/*
 * The arithmetic behind a 50/50 raffle, kept free of the database so the
 * pages, the CSV exports and the importer all get their numbers from one
 * place — and so the board (a client component) can share the labels.
 *
 * Two rules everything here follows:
 *
 *  - An IOU is not money. Only a payment row that hasn't been voided counts as
 *    collected; a box someone holds but hasn't paid for adds to sales and to
 *    what's outstanding, never to cash or Zelle.
 *  - The prize is a share of the boxes SOLD (paid for yet or not), at the
 *    raffle's price — the pack's own rule. It is a projection until the winner
 *    is recorded, which fixes it (Raffle.prizeCents).
 */

export const RAFFLE_METHODS = ["CASH", "ZELLE", "CHECK", "OTHER"] as const;
export type RaffleMethod = (typeof RAFFLE_METHODS)[number];

export const RAFFLE_METHOD_LABELS: Record<RaffleMethod, string> = {
  CASH: "Cash",
  ZELLE: "Zelle",
  CHECK: "Check",
  OTHER: "Other",
};

export function isRaffleMethod(value: string): value is RaffleMethod {
  return (RAFFLE_METHODS as readonly string[]).includes(value);
}

/** Enough for any board the pack would run, and small enough to draw on a phone. */
export const MAX_RAFFLE_BOXES = 500;

/** Cents as "$420.00" — the same format as formatCents in duesData.ts, which a client component can't import. */
export function formatRaffleMoney(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Box numbers as typed — "12, 15 18" or "12,15,18" — to a sorted list with
 * repeats dropped. Null for anything that isn't whole positive numbers, so the
 * caller can say so instead of guessing which box was meant.
 */
export function parseBoxNumbers(raw: string): number[] | null {
  const parts = raw.split(/[\s,;]+/).filter(Boolean);
  const numbers = new Set<number>();
  for (const part of parts) {
    if (!/^\d{1,4}$/.test(part)) return null;
    const value = Number(part);
    if (value < 1) return null;
    numbers.add(value);
  }
  return [...numbers].sort((a, b) => a - b);
}

/** [3, 9, 32] -> "3, 9, 32". */
export function formatBoxNumbers(numbers: number[]): string {
  return [...numbers].sort((a, b) => a - b).join(", ");
}

/** The winner's share of the boxes sold, to the cent. */
export function prizeForSales(soldBoxes: number, priceCents: number, prizePercent: number): number {
  return Math.round((soldBoxes * priceCents * prizePercent) / 100);
}

export type RaffleTerms = {
  boxCount: number;
  priceCents: number;
  prizePercent: number;
  /** Fixed prize once the winner is recorded; null before the drawing. */
  prizeCents: number | null;
  prizePaid: boolean;
};

export type RaffleEntryInput = { id: string; boxNumbers: number[] };

export type RafflePaymentInput = {
  entryId: string | null;
  method: RaffleMethod;
  amountCents: number;
  verified: boolean;
  voided: boolean;
};

export type RaffleEntryBalance = {
  owedCents: number;
  paidCents: number;
  /** Negative when they've paid more than their boxes cost. */
  remainingCents: number;
};

export type RaffleMethodTotals = { receivedCents: number; verifiedCents: number; unverifiedCents: number };

export type RaffleSummary = {
  boxCount: number;
  soldBoxes: number;
  availableBoxes: number;
  /** Boxes whose buyer is paid in full. */
  paidBoxes: number;
  /** Boxes held by a buyer who still owes anything. */
  unpaidBoxes: number;

  /** Every box sold at full price. */
  potentialCents: number;
  /** Boxes sold x price, paid for or not — the pot the prize is cut from. */
  salesCents: number;
  /** Money actually received, matched to a buyer or not. */
  collectedCents: number;
  byMethod: Record<RaffleMethod, RaffleMethodTotals>;
  /** Received but not yet tied to a buyer. Included in collectedCents. */
  unmatchedCents: number;
  /** What buyers still owe. */
  outstandingCents: number;
  /** Paid beyond what a buyer's boxes cost. */
  overpaidCents: number;
  /** Received but not yet counted or checked against the bank. */
  unverifiedCents: number;

  prizeCents: number;
  /** False while prizeCents is still a projection. */
  prizeIsFinal: boolean;
  /** The prize still to be handed over: the whole prize after the drawing until it's marked paid. */
  prizeOwedCents: number;
  /** Sales minus the prize — what the pack keeps once everyone has paid. */
  packShareCents: number;
  /** Money in hand minus the prize — what the pack keeps as things stand. */
  netCents: number;

  balances: Map<string, RaffleEntryBalance>;
};

export function summarizeRaffle(
  terms: RaffleTerms,
  entries: RaffleEntryInput[],
  payments: RafflePaymentInput[]
): RaffleSummary {
  const byMethod = Object.fromEntries(
    RAFFLE_METHODS.map((method) => [method, { receivedCents: 0, verifiedCents: 0, unverifiedCents: 0 }])
  ) as Record<RaffleMethod, RaffleMethodTotals>;

  const paidByEntry = new Map<string, number>();
  let collectedCents = 0;
  let unmatchedCents = 0;
  let unverifiedCents = 0;
  for (const payment of payments) {
    if (payment.voided) continue;
    collectedCents += payment.amountCents;
    const totals = byMethod[payment.method];
    totals.receivedCents += payment.amountCents;
    if (payment.verified) {
      totals.verifiedCents += payment.amountCents;
    } else {
      totals.unverifiedCents += payment.amountCents;
      unverifiedCents += payment.amountCents;
    }
    if (payment.entryId === null) unmatchedCents += payment.amountCents;
    else paidByEntry.set(payment.entryId, (paidByEntry.get(payment.entryId) ?? 0) + payment.amountCents);
  }

  const balances = new Map<string, RaffleEntryBalance>();
  let soldBoxes = 0;
  let paidBoxes = 0;
  let outstandingCents = 0;
  let overpaidCents = 0;
  for (const entry of entries) {
    const owedCents = entry.boxNumbers.length * terms.priceCents;
    const paidCents = paidByEntry.get(entry.id) ?? 0;
    const remainingCents = owedCents - paidCents;
    balances.set(entry.id, { owedCents, paidCents, remainingCents });
    soldBoxes += entry.boxNumbers.length;
    if (remainingCents <= 0) paidBoxes += entry.boxNumbers.length;
    if (remainingCents > 0) outstandingCents += remainingCents;
    else overpaidCents += -remainingCents;
  }

  const salesCents = soldBoxes * terms.priceCents;
  const prizeIsFinal = terms.prizeCents !== null;
  const prizeCents = terms.prizeCents ?? prizeForSales(soldBoxes, terms.priceCents, terms.prizePercent);

  return {
    boxCount: terms.boxCount,
    soldBoxes,
    availableBoxes: terms.boxCount - soldBoxes,
    paidBoxes,
    unpaidBoxes: soldBoxes - paidBoxes,
    potentialCents: terms.boxCount * terms.priceCents,
    salesCents,
    collectedCents,
    byMethod,
    unmatchedCents,
    outstandingCents,
    overpaidCents,
    unverifiedCents,
    prizeCents,
    prizeIsFinal,
    prizeOwedCents: prizeIsFinal && !terms.prizePaid ? prizeCents : 0,
    packShareCents: salesCents - prizeCents,
    netCents: collectedCents - prizeCents,
    balances,
  };
}
