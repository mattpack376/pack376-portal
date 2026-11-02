/*
 * The Ledger's arithmetic — ordering, running balance, category and bank
 * totals, scouting years — with no database access, so it can be unit tested
 * and shared by the page, the CSV export and the Google Sheet copy.
 *
 * Money is whole cents, always positive on a line; `direction` says which way
 * it went. Dates are the UTC-midnight Dates a @db.Date column stores (see
 * src/lib/dateOnly.ts), so every date here is read with getUTC* only.
 */

export type LedgerDirection = "IN" | "OUT";
export type LedgerCategoryKind = "FUND" | "EVENT";

/** What the math needs from a ledger line. */
export type LedgerMathEntry = {
  id: string;
  entryDate: Date;
  /** The Sheet row an imported line came from; null for lines typed in the portal. */
  importRowNumber: number | null;
  createdAt: Date;
  direction: LedgerDirection;
  amountCents: number;
  categoryId: string;
  /** Shared by the two lines of a move between categories. */
  transferId: string | null;
};

export type LedgerMathCategory = {
  id: string;
  name: string;
  kind: LedgerCategoryKind;
  sortOrder: number;
  archived: boolean;
};

export type LedgerCategorySummary = LedgerMathCategory & {
  inCents: number;
  outCents: number;
  netCents: number;
};

export type LedgerSummary = {
  /** Everything in minus everything out, all time. */
  bankBalanceCents: number;
  /** The bank balance less every EVENT category's positive balance (money set aside for an event). */
  availableToSpendCents: number;
  /** Per category, transfers included, all time — in the categories' own order. */
  categories: LedgerCategorySummary[];
  /** Money in and out during the period (all time if none), not counting moves between categories. */
  periodInCents: number;
  periodOutCents: number;
};

/** +cents for money in, -cents for money out. */
export function signedCents(entry: Pick<LedgerMathEntry, "direction" | "amountCents">): number {
  return entry.direction === "IN" ? entry.amountCents : -entry.amountCents;
}

/**
 * Ledger order: by date, then — within a day — imported lines in their Sheet
 * row order ahead of lines typed in the portal, then by when each was entered.
 * The id settles exact ties so the order never shuffles between page loads.
 */
export function compareLedgerEntries(
  a: Pick<LedgerMathEntry, "id" | "entryDate" | "importRowNumber" | "createdAt">,
  b: Pick<LedgerMathEntry, "id" | "entryDate" | "importRowNumber" | "createdAt">,
): number {
  const byDate = a.entryDate.getTime() - b.entryDate.getTime();
  if (byDate !== 0) return byDate;
  if (a.importRowNumber !== null || b.importRowNumber !== null) {
    if (a.importRowNumber === null) return 1;
    if (b.importRowNumber === null) return -1;
    if (a.importRowNumber !== b.importRowNumber) return a.importRowNumber - b.importRowNumber;
  }
  const byCreated = a.createdAt.getTime() - b.createdAt.getTime();
  if (byCreated !== 0) return byCreated;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A copy in ledger order, oldest first. */
export function sortLedgerEntries<T extends Pick<LedgerMathEntry, "id" | "entryDate" | "importRowNumber" | "createdAt">>(
  entries: readonly T[],
): T[] {
  return [...entries].sort(compareLedgerEntries);
}

/**
 * Every line, oldest first, with the bank balance after it. Pass every line
 * that counts (not deleted) and filter afterwards, so a filtered view still
 * shows the true balance on each line.
 */
export function withRunningBalance<T extends LedgerMathEntry>(entries: readonly T[]): (T & { balanceCents: number })[] {
  let balance = 0;
  return sortLedgerEntries(entries).map((entry) => {
    balance += signedCents(entry);
    return { ...entry, balanceCents: balance };
  });
}

/** Categories in the order the summary and the pickers show them: sortOrder, then name. */
export function sortLedgerCategories<T extends Pick<LedgerMathCategory, "name" | "sortOrder">>(categories: readonly T[]): T[] {
  return [...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

function isInPeriod(date: Date, period: { from: Date; to: Date } | undefined) {
  if (!period) return true;
  const time = date.getTime();
  return time >= period.from.getTime() && time <= period.to.getTime();
}

/**
 * The summary boxes. Category balances include moves between categories (a
 * trip closed out to Fundraising comes to $0, and Fundraising goes up by as
 * much), while the period's in/out totals leave those moves out — they never
 * touched the bank. Lines in a category that isn't in `categories` still
 * count toward the bank balance.
 */
export function summarizeLedger(
  entries: readonly LedgerMathEntry[],
  categories: readonly LedgerMathCategory[],
  period?: { from: Date; to: Date },
): LedgerSummary {
  const totals = new Map<string, { inCents: number; outCents: number }>();
  let bankBalanceCents = 0;
  let periodInCents = 0;
  let periodOutCents = 0;

  for (const entry of entries) {
    bankBalanceCents += signedCents(entry);
    const total = totals.get(entry.categoryId) ?? { inCents: 0, outCents: 0 };
    if (entry.direction === "IN") total.inCents += entry.amountCents;
    else total.outCents += entry.amountCents;
    totals.set(entry.categoryId, total);

    if (entry.transferId === null && isInPeriod(entry.entryDate, period)) {
      if (entry.direction === "IN") periodInCents += entry.amountCents;
      else periodOutCents += entry.amountCents;
    }
  }

  const summaries = sortLedgerCategories(categories).map((category) => {
    const { inCents, outCents } = totals.get(category.id) ?? { inCents: 0, outCents: 0 };
    return { ...category, inCents, outCents, netCents: inCents - outCents };
  });
  const setAsideCents = summaries
    .filter((category) => category.kind === "EVENT" && category.netCents > 0)
    .reduce((sum, category) => sum + category.netCents, 0);

  return {
    bankBalanceCents,
    availableToSpendCents: bankBalanceCents - setAsideCents,
    categories: summaries,
    periodInCents,
    periodOutCents,
  };
}

/*
 * Scouting years run September 1 through August 31, written "2026-2027" — the
 * same labels the dens use.
 */

/** The scouting year a date falls in: Sep 1, 2026 – Aug 31, 2027 is "2026-2027". */
export function scoutingYearOf(date: Date): string {
  const year = date.getUTCFullYear();
  const start = date.getUTCMonth() >= 8 ? year : year - 1;
  return `${start}-${start + 1}`;
}

/** A "YYYY-YYYY" scouting year from a URL or form, or null when it isn't one. */
export function parseLedgerScoutingYear(value: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{4})$/.exec((value ?? "").trim());
  if (!match) return null;
  const start = Number(match[1]);
  if (Number(match[2]) !== start + 1 || start < 2000 || start > 2199) return null;
  return `${start}-${start + 1}`;
}

/** First and last day of a scouting year, inclusive, as UTC-midnight dates. */
export function scoutingYearRange(scoutingYear: string): { from: Date; to: Date } {
  const parsed = parseLedgerScoutingYear(scoutingYear);
  if (!parsed) throw new Error(`Not a scouting year: "${scoutingYear}".`);
  const start = Number(parsed.slice(0, 4));
  return { from: new Date(Date.UTC(start, 8, 1)), to: new Date(Date.UTC(start + 1, 7, 31)) };
}

/** Whether a date falls in a scouting year. */
export function isInScoutingYear(date: Date, scoutingYear: string): boolean {
  return scoutingYearOf(date) === scoutingYear;
}

/** Every scouting year with a line in it, plus the current one, newest first. */
export function ledgerScoutingYears(dates: readonly Date[], today: Date): string[] {
  const years = new Set(dates.map(scoutingYearOf));
  years.add(scoutingYearOf(today));
  return [...years].sort().reverse();
}

/** "Fundraising " -> "fundraising": what makes two category names the same. */
export function ledgerCategoryNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
