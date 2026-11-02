"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { assertLedgerAccess } from "@/lib/authorize";
import { getLedgerSyncView, markLedgerSyncRequested, runLedgerSync, waitForLedgerSync } from "@/lib/ledgerSync";
import type { LedgerSyncStatus } from "@/lib/ledgerSync";

/*
 * The Ledger's "Sync now" button. Its own "use server" file (every export of
 * one is a public endpoint), so the sync code itself stays out of
 * actions/ledger.ts. Only the two ledger accounts can run it. Not audited:
 * it changes nothing in the portal, only refreshes the Sheet's copy.
 */

export type LedgerSyncNowState = { status?: LedgerSyncStatus; message?: string };

/** How long Sync now waits for a sync that's already running before answering. */
const BUSY_WAIT_MS = 5_000;

/** For useActionState: takes no input (the previous state and the form are ignored). */
export async function syncLedgerNowAction(): Promise<LedgerSyncNowState> {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  await assertLedgerAccess(session);

  const view = await getLedgerSyncView();
  if (!view.configured) return { status: "skipped", message: "The Google Sheet copy isn't set up yet." };
  if (!view.enabled) return { status: "disabled", message: "The Sheet copy is off. Turn it on under Import & Settings first." };
  // Marked first, so a sync that's already running does another pass for this.
  await markLedgerSyncRequested();

  const result = await runLedgerSync({ reason: "manual" });
  revalidatePath("/portal/admin/ledger", "layout");

  switch (result.status) {
    case "synced":
      return {
        status: "synced",
        message: `Synced: ${result.rowCount === 1 ? "1 line" : `${result.rowCount ?? 0} lines`} in the Portal Ledger tab.`,
      };
    case "failed":
      return { status: "failed", message: `Sync failed: ${result.error ?? "unknown error"}` };
    case "disabled":
      return { status: "disabled", message: "The Sheet copy is off. Turn it on under Import & Settings first." };
    case "skipped":
      return { status: "skipped", message: "The Google Sheet copy isn't set up yet." };
    case "busy": {
      if (!(await waitForLedgerSync(BUSY_WAIT_MS))) {
        return { status: "busy", message: "A sync is already running and will include this. Check back in a minute." };
      }
      const after = await getLedgerSyncView();
      if (after.lastSyncError) return { status: "failed", message: `Sync failed: ${after.lastSyncError}` };
      return { status: "synced", message: after.behind ? "Synced; another change is on its way to the Sheet." : "Synced." };
    }
  }
}
