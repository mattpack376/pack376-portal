import "server-only";
import { prisma } from "@/lib/prisma";
import { getLedger, getLedgerSettings } from "@/lib/ledgerData";
import { buildLedgerSheetGrid } from "@/lib/ledgerSheetLayout";
import { readSheetsConfig } from "@/lib/googleSheetsConfig";
import { PACK_TIME_ZONE } from "@/lib/dateOnly";
import { requestLedgerSync } from "@/lib/ledgerSyncTrigger";
import {
  SheetsError,
  SHEETS_DEADLINE_MS,
  writePortalLedgerTab,
  type SheetGrid,
  type StoredPortalTab,
} from "@/lib/googleSheets";
import {
  isSyncBehind,
  runLedgerSyncLoop,
  type LedgerSyncPass,
  type LedgerSyncResult,
  type LedgerSyncStore,
} from "@/lib/ledgerSyncLoop";

export type { LedgerSyncResult, LedgerSyncStatus } from "@/lib/ledgerSyncLoop";

/*
 * Keeps the "Portal Ledger" tab of the Google Sheet in step with the ledger
 * (one way: portal → Sheet). How runs are serialized and coalesced is in
 * ledgerSyncLoop.ts; this file holds its database side and wires in Google.
 *
 * Rules this file keeps:
 * - Lease and status updates are single SQL statements outside any
 *   transaction, and no transaction is ever open while Google is called.
 * - Nothing here writes an audit entry (an audited change asks for a sync, so
 *   a sync that audited itself could ask for another).
 * - Only short, mapped messages are saved or returned (lastSyncError), never
 *   Google's replies or anything secret.
 *
 * Timestamps are written as UTC wall-clock time, the way Prisma stores
 * DateTime columns, and cut to milliseconds (the columns' precision) so a
 * request and the sync that covers it compare exactly.
 */

export type LedgerSyncReason = "auto" | "manual" | "cron";

/** Writes the grid to the Sheet; tests pass a stand-in. */
export type LedgerSheetWriter = (
  grid: SheetGrid,
  stored: StoredPortalTab,
  signal: AbortSignal,
) => Promise<{ spreadsheetId: string; sheetTabId: number }>;

/** Makes sure the settings row exists (the lease lives in it). */
async function ensureSettingsRow() {
  await prisma.$executeRaw`
    INSERT INTO "LedgerSettings" ("id", "updatedAt") VALUES ('main', now() AT TIME ZONE 'UTC')
    ON CONFLICT ("id") DO NOTHING`;
}

/**
 * The LedgerSettings lease and status fields, through plain SQL statements.
 * The lease runs 90 seconds — longer than any function's time limit (60 s),
 * so a running sync never loses it. Its token is the syncLeaseUntil value,
 * which changes with every renewal; a holder whose lease ran out changes
 * nothing.
 */
export const prismaLedgerSyncStore: LedgerSyncStore = {
  async acquire() {
    await ensureSettingsRow();
    const rows = await prisma.$queryRaw<{ syncLeaseUntil: Date }[]>`
      UPDATE "LedgerSettings"
      SET "syncLeaseUntil" = (now() AT TIME ZONE 'UTC') + interval '90 seconds',
          "lastSyncAttemptAt" = now() AT TIME ZONE 'UTC'
      WHERE "id" = 'main' AND ("syncLeaseUntil" IS NULL OR "syncLeaseUntil" < now() AT TIME ZONE 'UTC')
      RETURNING "syncLeaseUntil"`;
    return rows[0] ? rows[0].syncLeaseUntil.toISOString() : null;
  },

  async renew(token) {
    const rows = await prisma.$queryRaw<
      {
        syncLeaseUntil: Date;
        startedAt: Date;
        syncRequestedAt: Date | null;
        syncedThrough: Date | null;
        syncEnabled: boolean;
        spreadsheetId: string | null;
        sheetTabId: number | null;
      }[]
    >`
      UPDATE "LedgerSettings"
      SET "syncLeaseUntil" = (now() AT TIME ZONE 'UTC') + interval '90 seconds'
      WHERE "id" = 'main' AND "syncLeaseUntil" = (CAST(${token} AS timestamptz) AT TIME ZONE 'UTC')
      RETURNING "syncLeaseUntil", date_trunc('milliseconds', now() AT TIME ZONE 'UTC') AS "startedAt",
        "syncRequestedAt", "syncedThrough", "syncEnabled", "spreadsheetId", "sheetTabId"`;
    const row = rows[0];
    if (!row) return null;
    const pass: LedgerSyncPass = {
      startedAt: row.startedAt,
      syncRequestedAt: row.syncRequestedAt,
      syncedThrough: row.syncedThrough,
      syncEnabled: row.syncEnabled,
      stored: { spreadsheetId: row.spreadsheetId, sheetTabId: row.sheetTabId },
    };
    return { token: row.syncLeaseUntil.toISOString(), pass };
  },

  async saveSuccess(token, done) {
    await prisma.$executeRaw`
      UPDATE "LedgerSettings"
      SET "syncedThrough" = GREATEST(
            COALESCE("syncedThrough", CAST(${done.syncedThrough.toISOString()} AS timestamptz) AT TIME ZONE 'UTC'),
            CAST(${done.syncedThrough.toISOString()} AS timestamptz) AT TIME ZONE 'UTC'),
          "lastSyncedAt" = now() AT TIME ZONE 'UTC',
          "lastSyncError" = NULL,
          "lastSyncRowCount" = ${done.rowCount},
          "spreadsheetId" = ${done.spreadsheetId},
          "sheetTabId" = ${done.sheetTabId}
      WHERE "id" = 'main' AND "syncLeaseUntil" = (CAST(${token} AS timestamptz) AT TIME ZONE 'UTC')`;
  },

  async saveFailure(token, message) {
    await prisma.$executeRaw`
      UPDATE "LedgerSettings" SET "lastSyncError" = ${message}
      WHERE "id" = 'main' AND "syncLeaseUntil" = (CAST(${token} AS timestamptz) AT TIME ZONE 'UTC')`;
  },

  async release(token) {
    await prisma.$executeRaw`
      UPDATE "LedgerSettings" SET "syncLeaseUntil" = NULL
      WHERE "id" = 'main' AND "syncLeaseUntil" = (CAST(${token} AS timestamptz) AT TIME ZONE 'UTC')`;
  },

  async isBehind() {
    const settings = await prisma.ledgerSettings.findUnique({
      where: { id: "main" },
      select: { syncEnabled: true, syncRequestedAt: true, syncedThrough: true },
    });
    return !!settings && settings.syncEnabled && isSyncBehind(settings.syncRequestedAt, settings.syncedThrough);
  },
};

/**
 * Notes that the ledger changed and the Sheet should catch up. Called after
 * the change committed (from requestLedgerSync's after() callback, or Sync
 * now). Never moves the request time backwards.
 */
export async function markLedgerSyncRequested(): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "LedgerSettings" ("id", "syncRequestedAt", "updatedAt")
    VALUES ('main', date_trunc('milliseconds', now() AT TIME ZONE 'UTC'), now() AT TIME ZONE 'UTC')
    ON CONFLICT ("id") DO UPDATE SET "syncRequestedAt" =
      GREATEST(COALESCE("LedgerSettings"."syncRequestedAt", EXCLUDED."syncRequestedAt"), EXCLUDED."syncRequestedAt")`;
}

/** The message saved for a failed sync: a SheetsError's own short text, otherwise a generic one. */
export function describeLedgerSyncError(error: unknown): string {
  if (error instanceof SheetsError) return error.message;
  const name = (error as { name?: unknown } | null)?.name;
  const code = (error as { code?: unknown } | null)?.code;
  console.error(
    `[ledger-sync] sync failed: ${typeof name === "string" ? name : "error"}${typeof code === "string" ? ` ${code}` : ""}`,
  );
  return "The sync failed unexpectedly. Try Sync now; if it keeps failing, check the site's logs.";
}

/**
 * Brings the Sheet's "Portal Ledger" tab up to date, unless another sync is
 * already doing it (then "busy": that one picks up this request too). Does
 * nothing ("skipped") when the Sheet isn't set up here. Never throws.
 *
 * `write` is for tests: a stand-in for Google (which also skips the
 * is-it-set-up check).
 */
export async function runLedgerSync({
  reason,
  write,
  signal,
}: {
  reason: LedgerSyncReason;
  write?: LedgerSheetWriter;
  signal?: AbortSignal;
}): Promise<LedgerSyncResult> {
  try {
    const config = readSheetsConfig();
    if (!write && !config) return { status: "skipped", passes: 0 };
    const deadline = signal ?? AbortSignal.timeout(SHEETS_DEADLINE_MS);
    const writer: LedgerSheetWriter = write ?? ((grid, stored, s) => writePortalLedgerTab(grid, { stored, signal: s, config }));

    const result = await runLedgerSyncLoop({
      store: prismaLedgerSyncStore,
      signal: deadline,
      describeError: describeLedgerSyncError,
      write: async (stored, s) => {
        const ledger = await getLedger();
        const grid = buildLedgerSheetGrid(ledger, { now: new Date() });
        const written = await writer(grid, stored, s);
        return { ...written, rowCount: ledger.allRows.length };
      },
    });
    if (result.status === "failed") console.error(`[ledger-sync] ${reason} sync failed after ${result.passes} pass(es)`);
    return result;
  } catch (error) {
    return { status: "failed", passes: 0, error: describeLedgerSyncError(error) };
  }
}

/** Waits (up to `ms`) for a sync someone else is running to let go of the lease. True if it did. */
export async function waitForLedgerSync(ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  for (;;) {
    const settings = await prisma.ledgerSettings.findUnique({ where: { id: "main" }, select: { syncLeaseUntil: true } });
    if (!settings?.syncLeaseUntil || settings.syncLeaseUntil.getTime() < Date.now()) return true;
    if (Date.now() >= until) return false;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// ---------- The status line on the ledger pages ----------

export type LedgerSyncView = {
  /** The Google settings are in place on this deployment. */
  configured: boolean;
  /** The treasurer's on/off switch (Import & Settings). */
  enabled: boolean;
  /** "Nov 2, 2026, 3:14 PM" in the pack's time zone, or null if never. */
  lastSyncedLabel: string | null;
  lastSyncRowCount: number | null;
  lastSyncError: string | null;
  /** The Sheet is missing a change the portal has. */
  behind: boolean;
  /** A sync holds the lease right now. */
  running: boolean;
};

/** Don't ask again from a page load while a recent try is this fresh (a failing sync isn't retried on every view). */
const NUDGE_AFTER_MS = 2 * 60_000;

export function formatSyncTime(date: Date): string {
  return date
    .toLocaleString("en-US", { timeZone: PACK_TIME_ZONE, dateStyle: "medium", timeStyle: "short" })
    .replace(/ /g, " ");
}

/**
 * What the sync status line shows. With `nudge`, a page load that finds the
 * Sheet behind (a sync that failed or was cut short) asks for another, so it
 * catches up without waiting for the daily run.
 */
export async function getLedgerSyncView({ nudge = false }: { nudge?: boolean } = {}): Promise<LedgerSyncView> {
  const settings = await getLedgerSettings();
  const configured = readSheetsConfig() !== null;
  const now = Date.now();
  const running = !!settings.syncLeaseUntil && settings.syncLeaseUntil.getTime() > now;
  const behind = isSyncBehind(settings.syncRequestedAt, settings.syncedThrough);

  if (
    nudge &&
    configured &&
    settings.syncEnabled &&
    behind &&
    !running &&
    (!settings.lastSyncAttemptAt || now - settings.lastSyncAttemptAt.getTime() > NUDGE_AFTER_MS)
  ) {
    requestLedgerSync();
  }

  return {
    configured,
    enabled: settings.syncEnabled,
    lastSyncedLabel: settings.lastSyncedAt ? formatSyncTime(settings.lastSyncedAt) : null,
    lastSyncRowCount: settings.lastSyncRowCount,
    lastSyncError: settings.lastSyncError,
    behind,
    running,
  };
}
