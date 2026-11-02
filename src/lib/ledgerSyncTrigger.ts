import "server-only";
import { cache } from "react";
import { after } from "next/server";
import { isSheetsConfigured } from "@/lib/googleSheetsConfig";

/** One flag per request, so a request that changes several things asks for one sync. */
const thisRequest = cache(() => ({ asked: false }));

/**
 * Asks for the Ledger's Google Sheet copy to be brought up to date, after a
 * ledger change has been saved. Called by every action in
 * src/lib/actions/ledger.ts once its transaction has committed (and by a
 * ledger page that finds the Sheet behind).
 *
 * The sync itself runs in after(), once the response has gone, so a save
 * never waits on Google. It must never throw — a change that already saved
 * must not be reported as failed because the Sheet couldn't be asked to catch
 * up — so the whole body is wrapped, and the sync code (and the signing
 * library) is only loaded inside the callback.
 */
export function requestLedgerSync(): void {
  try {
    if (!isSheetsConfigured()) return;
    const flag = thisRequest();
    if (flag.asked) return;
    flag.asked = true;
    after(async () => {
      try {
        const { markLedgerSyncRequested, runLedgerSync } = await import("./ledgerSync");
        await markLedgerSyncRequested();
        await runLedgerSync({ reason: "auto" });
      } catch (error) {
        const name = (error as { name?: unknown } | null)?.name;
        console.error(`[ledger-sync] couldn't start a sync: ${typeof name === "string" ? name : "error"}`);
      }
    });
  } catch {
    // Never let a sync request break the save that asked for it.
  }
}
