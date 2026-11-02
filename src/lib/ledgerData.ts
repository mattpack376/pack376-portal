import "server-only";
import { prisma } from "@/lib/prisma";
import { todayDateOnly } from "@/lib/dateOnly";
import {
  isInScoutingYear,
  ledgerCategoryNameKey,
  ledgerScoutingYears,
  scoutingYearRange,
  sortLedgerCategories,
  summarizeLedger,
  withRunningBalance,
} from "@/lib/ledgerMath";

/*
 * Loaders for the Ledger (/portal/admin/ledger). No access check of their own:
 * every caller — the ledger pages, the export route, the Sheet sync — has
 * already passed requireLedgerSession or assertLedgerAccess (or runs as the
 * sync, after one of those). Keep it that way: anything that imports this
 * file shows the pack's books.
 */

/** The category every ledger starts with, so the Add form always has one to pick. */
export const GENERAL_FUND_NAME = "General Fund";

/** Longest search text the filter uses; anything longer is cut. */
const MAX_SEARCH_LENGTH = 100;

/** How many deleted lines the page lists (newest deletions first). */
const DELETED_SHOWN = 200;

/** The settings row, or its defaults when nothing has been saved yet (nothing is written). */
export async function getLedgerSettings() {
  const settings = await prisma.ledgerSettings.findUnique({ where: { id: "main" } });
  return (
    settings ?? {
      id: "main",
      cutoverDate: null,
      syncEnabled: true,
      spreadsheetId: null,
      sheetTabId: null,
      syncRequestedAt: null,
      syncedThrough: null,
      syncLeaseUntil: null,
      lastSyncAttemptAt: null,
      lastSyncedAt: null,
      lastSyncError: null,
      lastSyncRowCount: null,
      updatedAt: null,
    }
  );
}

export type LedgerSettingsView = Awaited<ReturnType<typeof getLedgerSettings>>;

/**
 * Creates the General Fund category when there are no categories at all, so
 * a brand-new ledger has one to pick. Only then: once any category exists the
 * treasurer may rename or delete this one, and it must not come back. Runs
 * while the page renders (like getOrCreateTripPage); two first visits at once
 * both try, and the unique name lets one win.
 */
export async function ensureGeneralFund() {
  if ((await prisma.ledgerCategory.count()) > 0) return;
  const nameKey = ledgerCategoryNameKey(GENERAL_FUND_NAME);
  try {
    await prisma.ledgerCategory.create({ data: { name: GENERAL_FUND_NAME, nameKey, kind: "FUND", sortOrder: 0 } });
  } catch (error) {
    if ((error as { code?: unknown })?.code !== "P2002") throw error;
  }
}

/** Every category, in display order, with how many lines (deleted ones included) use it. */
export async function getLedgerCategories() {
  const categories = await prisma.ledgerCategory.findMany({
    include: { _count: { select: { entries: true } } },
  });
  return sortLedgerCategories(categories).map(({ _count, ...category }) => ({ ...category, entryCount: _count.entries }));
}

export type LedgerCategoryView = Awaited<ReturnType<typeof getLedgerCategories>>[number];

const ENTRY_SELECT = {
  id: true,
  entryDate: true,
  description: true,
  categoryId: true,
  direction: true,
  amountCents: true,
  note: true,
  origin: true,
  transferId: true,
  importBatchId: true,
  importRowNumber: true,
  createdByName: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  deletedByName: true,
} as const;

export type LedgerFilters = {
  /** "2026-2027"; null or undefined for every year. */
  year?: string | null;
  categoryId?: string | null;
  /** Matched, ignoring case, against the description, note and category name. */
  q?: string | null;
};

/**
 * The whole ledger. Running balances are worked out over every line that
 * counts before any filter, so a filtered view still shows the real bank
 * balance on each line. `rows` is the filtered view and `allRows` every line,
 * both oldest first; the summary is all time, with the period totals for the
 * chosen year (or all time).
 */
export async function getLedger(filters: LedgerFilters = {}) {
  await ensureGeneralFund();
  const [categories, entries, deleted, settings] = await Promise.all([
    getLedgerCategories(),
    prisma.ledgerEntry.findMany({ where: { deletedAt: null }, select: ENTRY_SELECT }),
    prisma.ledgerEntry.findMany({
      // Lines of an undone import aren't listed: they come back by importing again, not one by one.
      where: { deletedAt: { not: null }, OR: [{ importBatchId: null }, { importBatch: { undoneAt: null } }] },
      select: ENTRY_SELECT,
      orderBy: [{ deletedAt: "desc" }, { id: "asc" }],
      take: DELETED_SHOWN,
    }),
    getLedgerSettings(),
  ]);

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  // The other half of a move between categories, to say where it went.
  const transferHalves = new Map<string, typeof entries>();
  for (const entry of entries) {
    if (entry.transferId) transferHalves.set(entry.transferId, [...(transferHalves.get(entry.transferId) ?? []), entry]);
  }
  const transferPartner = new Map<string, string>();
  for (const halves of transferHalves.values()) {
    for (const entry of halves) {
      const partner = halves.find((e) => e.id !== entry.id);
      if (partner) transferPartner.set(entry.id, categoryName.get(partner.categoryId) ?? "");
    }
  }

  const allRows = withRunningBalance(entries).map((entry) => ({
    ...entry,
    categoryName: categoryName.get(entry.categoryId) ?? "",
    /** For a move between categories, the category on the other side. */
    transferWith: transferPartner.get(entry.id) ?? null,
    /** Sent back by the Edit form; a save from an out-of-date page is refused. */
    version: entry.updatedAt.toISOString(),
  }));

  const year = filters.year ?? null;
  const categoryId = filters.categoryId || null;
  const q = (filters.q ?? "").trim().slice(0, MAX_SEARCH_LENGTH).toLowerCase();
  const rows = allRows.filter(
    (row) =>
      (!year || isInScoutingYear(row.entryDate, year)) &&
      (!categoryId || row.categoryId === categoryId) &&
      (!q ||
        row.description.toLowerCase().includes(q) ||
        (row.note ?? "").toLowerCase().includes(q) ||
        row.categoryName.toLowerCase().includes(q)),
  );

  const summary = summarizeLedger(entries, categories, year ? scoutingYearRange(year) : undefined);
  const today = todayDateOnly();

  return {
    rows,
    allRows,
    summary,
    categories,
    /** What the Add and Move forms offer: everything not archived. */
    activeCategories: categories.filter((c) => !c.archived),
    deletedEntries: deleted.map((entry) => ({ ...entry, categoryName: categoryName.get(entry.categoryId) ?? "" })),
    settings,
    years: ledgerScoutingYears(
      entries.map((e) => e.entryDate),
      today,
    ),
    filters: { year, categoryId, q },
  };
}

export type LedgerData = Awaited<ReturnType<typeof getLedger>>;
export type LedgerRow = LedgerData["allRows"][number];
export type DeletedLedgerEntry = LedgerData["deletedEntries"][number];
