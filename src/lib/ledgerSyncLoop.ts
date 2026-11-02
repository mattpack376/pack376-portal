import type { StoredPortalTab } from "@/lib/googleSheets";

/*
 * The Sheet sync's bookkeeping, apart from the database and Google so it can
 * be tested on its own (ledgerSync.ts plugs in the real ones).
 *
 * Only one sync runs at a time, held by a lease in LedgerSettings. Each pass:
 * renew the lease (which also reads the database clock as `startedAt`), read
 * the whole ledger, write the Sheet, then save syncedThrough = startedAt.
 * Every change asks for a sync AFTER it has committed (syncRequestedAt), so a
 * snapshot read after startedAt includes every change asked for up to then;
 * a change asked for later leaves syncRequestedAt > syncedThrough, and the
 * holder of the lease does another pass for it. That way a burst of saves
 * becomes one or two Sheet writes, not one each. A request that comes in just
 * as the lease is let go is caught by checking once more afterwards.
 */

export type LedgerSyncStatus = "synced" | "busy" | "failed" | "disabled" | "skipped";

export type LedgerSyncResult = {
  status: LedgerSyncStatus;
  /** Sheet writes made. */
  passes: number;
  /** Lines in the Sheet after the last write. */
  rowCount?: number;
  /** A short, safe message when status is "failed". */
  error?: string;
};

/** Read at the start of each pass, as the lease is renewed. */
export type LedgerSyncPass = {
  /** The database clock just before this pass reads the ledger. */
  startedAt: Date;
  syncRequestedAt: Date | null;
  syncedThrough: Date | null;
  syncEnabled: boolean;
  stored: StoredPortalTab;
};

export type LedgerSyncWritten = { spreadsheetId: string; sheetTabId: number; rowCount: number };

/** The lease and status fields of LedgerSettings. `token` identifies one holder's lease. */
export interface LedgerSyncStore {
  /** Takes the lease if nobody holds it; null when another sync is running. */
  acquire(): Promise<string | null>;
  /** Extends the lease, giving its new token; null when it was lost (it ran out and someone else took it). */
  renew(token: string): Promise<{ token: string; pass: LedgerSyncPass } | null>;
  saveSuccess(token: string, done: LedgerSyncWritten & { syncedThrough: Date }): Promise<void>;
  saveFailure(token: string, message: string): Promise<void>;
  release(token: string): Promise<void>;
  /** Whether a sync is due: asked for after the last one read the ledger, and the copy is on. */
  isBehind(): Promise<boolean>;
}

export type LedgerSyncDeps = {
  store: LedgerSyncStore;
  /** Reads the ledger fresh and writes it to the Sheet. */
  write: (stored: StoredPortalTab, signal: AbortSignal) => Promise<LedgerSyncWritten>;
  /** One deadline for the whole run. */
  signal: AbortSignal;
  /** Turns a failure into the short message saved for the treasurer. */
  describeError: (error: unknown) => string;
  maxPasses?: number;
};

export const MAX_SYNC_PASSES = 3;
/** Longest lastSyncError saved. */
export const MAX_SYNC_ERROR_LENGTH = 300;

/** True when a sync was asked for after the last successful one started reading. */
export function isSyncBehind(syncRequestedAt: Date | null, syncedThrough: Date | null): boolean {
  if (!syncRequestedAt) return false;
  return !syncedThrough || syncRequestedAt.getTime() > syncedThrough.getTime();
}

async function runPasses(deps: LedgerSyncDeps): Promise<LedgerSyncResult> {
  const { store, signal } = deps;
  const maxPasses = deps.maxPasses ?? MAX_SYNC_PASSES;
  let token = await store.acquire();
  if (!token) return { status: "busy", passes: 0 };

  let result: LedgerSyncResult = { status: "synced", passes: 0 };
  try {
    while (result.passes < maxPasses) {
      // Out of time: leave whatever is still asked for to the next trigger.
      if (result.passes > 0 && signal.aborted) break;
      const renewed = await store.renew(token);
      if (!renewed) {
        if (result.passes === 0) result = { status: "busy", passes: 0 };
        break;
      }
      token = renewed.token;
      const { pass } = renewed;
      if (!pass.syncEnabled) {
        result = { ...result, status: "disabled" };
        break;
      }
      // The first pass always writes (Sync now and the daily run refresh the
      // tab even when nothing changed); later ones only for a newer request.
      if (result.passes > 0 && !isSyncBehind(pass.syncRequestedAt, pass.syncedThrough)) break;

      const passes = result.passes + 1;
      try {
        const written = await deps.write(pass.stored, signal);
        await store.saveSuccess(token, { ...written, syncedThrough: pass.startedAt });
        result = { status: "synced", passes, rowCount: written.rowCount };
      } catch (error) {
        const message = deps.describeError(error).slice(0, MAX_SYNC_ERROR_LENGTH);
        await store.saveFailure(token, message);
        result = { status: "failed", passes, error: message };
        break;
      }
    }
  } finally {
    await store.release(token);
  }
  return result;
}

/** One sync run: the passes under the lease, then one more look for a request that slipped in at the end. */
export async function runLedgerSyncLoop(deps: LedgerSyncDeps): Promise<LedgerSyncResult> {
  const first = await runPasses(deps);
  if (first.status !== "synced" || deps.signal.aborted || !(await deps.store.isBehind())) return first;
  const again = await runPasses(deps);
  // Someone else took it from here: our own writes still stand.
  if (again.status === "busy") return first;
  return { ...again, passes: first.passes + again.passes, rowCount: again.rowCount ?? first.rowCount };
}
