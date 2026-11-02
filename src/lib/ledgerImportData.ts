import "server-only";
import { prisma } from "@/lib/prisma";
import { isSheetsConfigured } from "@/lib/googleSheetsConfig";
import { defaultImportTab } from "@/lib/ledgerImport";

/*
 * Loaders for the Ledger's Import & Settings page. Like ledgerData.ts they
 * check no access themselves: the page has already passed
 * requireLedgerSession.
 */

/** How long the page waits for Google's tab list before offering the CSV upload alone. */
const TAB_LIST_TIMEOUT_MS = 10_000;

export type LedgerImportTabs = {
  /** Whether the Google Sheet connection is set up here at all. */
  configured: boolean;
  /** The treasurer's tabs (never the portal's own). */
  tabs: string[];
  defaultTab: string | null;
  /** A short message when the list couldn't be read. */
  error: string | null;
};

/** The Sheet's tabs the import can read, newest scouting year first in the default. */
export async function getLedgerImportTabs(): Promise<LedgerImportTabs> {
  if (!isSheetsConfigured()) return { configured: false, tabs: [], defaultTab: null, error: null };
  // Loaded only when the Sheet is set up, so the page doesn't pull in the signing library otherwise.
  const { listTabs, isPortalTab, PORTAL_TAB_TITLE, SheetsError } = await import("@/lib/googleSheets");
  try {
    const all = await listTabs({ signal: AbortSignal.timeout(TAB_LIST_TIMEOUT_MS) });
    const tabs = all
      .filter((tab) => !isPortalTab(tab) && tab.title.trim().toLowerCase() !== PORTAL_TAB_TITLE.toLowerCase())
      .map((tab) => tab.title);
    return { configured: true, tabs, defaultTab: defaultImportTab(tabs) ?? tabs[0] ?? null, error: null };
  } catch (error) {
    if (!(error instanceof SheetsError)) console.error(`[ledger-import] tab list failed: ${(error as Error)?.name ?? "error"}`);
    const message = error instanceof SheetsError ? error.message : "Couldn't read the Sheet's list of tabs.";
    return { configured: true, tabs: [], defaultTab: null, error: message };
  }
}

/** Every import, newest first, with how many of its lines are still in the ledger. */
export async function getLedgerImportBatches() {
  const batches = await prisma.ledgerImportBatch.findMany({ orderBy: { importedAt: "desc" } });
  const live = await prisma.ledgerEntry.groupBy({
    by: ["importBatchId"],
    where: { importBatchId: { in: batches.map((b) => b.id) }, deletedAt: null },
    _count: { _all: true },
  });
  const liveCount = new Map(live.map((row) => [row.importBatchId, row._count._all]));
  return batches.map((batch) => ({ ...batch, liveCount: liveCount.get(batch.id) ?? 0 }));
}

export type LedgerImportBatchView = Awaited<ReturnType<typeof getLedgerImportBatches>>[number];
