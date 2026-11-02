/*
 * The Ledger's Google Sheet sync against a real database, with a stand-in
 * for Google (runLedgerSync's `write`): the lease in LedgerSettings, the
 * request / synced-through bookkeeping, failures, the on/off switch, and the
 * Sync now action's access check. Nothing here talks to Google, and the sync
 * never writes an audit entry.
 *
 * All names and amounts are invented.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { exportPKCS8, generateKeyPair } from "jose";
import { withTestDatabase } from "../support/db";
import { asAnonymous, form, resetTestState, runAs, settle, testState, type SessionUser } from "../support/context";
import { todayDateOnlyString } from "@/lib/dateOnly";
import type { SheetGrid, StoredPortalTab } from "@/lib/googleSheets";

const db = withTestDatabase("ledger_sync");
let sync: typeof import("@/lib/ledgerSync");
let ledger: typeof import("@/lib/actions/ledger");
let syncActions: typeof import("@/lib/actions/ledgerSync");
let SheetsError: typeof import("@/lib/googleSheets").SheetsError;

let master: SessionUser;
let treasurer: SessionUser;
let plainAdmin: SessionUser;
let juniorAdmin: SessionUser;
let fundraisingId = "";

const GOOGLE_ENV = [
  "VERCEL_ENV",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
  "GOOGLE_LEDGER_SPREADSHEET_ID",
  "GOOGLE_LEDGER_TEST_SPREADSHEET_ID",
] as const;
const savedEnv = Object.fromEntries(GOOGLE_ENV.map((name) => [name, process.env[name]]));
function clearGoogleEnv() {
  for (const name of GOOGLE_ENV) delete process.env[name];
}

before(async () => {
  clearGoogleEnv();
  await db.ready;
  sync = await import("@/lib/ledgerSync");
  ledger = await import("@/lib/actions/ledger");
  syncActions = await import("@/lib/actions/ledgerSync");
  ({ SheetsError } = await import("@/lib/googleSheets"));

  async function make(username: string, role: SessionUser["role"], displayName: string): Promise<SessionUser> {
    const user = await db.prisma.user.create({ data: { username, passwordHash: "x", role, displayName } });
    return { id: user.id, role, sessionVersion: 0, displayName };
  }
  master = await make("mattrosen", "ADMIN", "Ledger Master");
  treasurer = await make("dianaliz", "ADMIN", "Ledger Treasurer");
  plainAdmin = await make("sync-plain-admin", "ADMIN", "Plain Admin");
  juniorAdmin = await make("sync-junior", "JUNIOR_ADMIN", "Junior Admin");
  fundraisingId = (await db.prisma.ledgerCategory.create({ data: { name: "Fundraising", nameKey: "fundraising", sortOrder: 10 } })).id;
});

after(() => {
  for (const name of GOOGLE_ENV) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});

beforeEach(async () => {
  resetTestState();
  clearGoogleEnv();
  // A clean settings row for each test.
  await db.prisma.ledgerSettings.deleteMany();
});

/** A stand-in for Google that records each write. */
function fakeSheet(onWrite?: (call: number) => Promise<void> | void) {
  const writes: { grid: SheetGrid; stored: StoredPortalTab }[] = [];
  const write = async (grid: SheetGrid, stored: StoredPortalTab) => {
    writes.push({ grid, stored });
    await onWrite?.(writes.length);
    return { spreadsheetId: "TEST_spreadsheet_id_0123456789", sheetTabId: 4242 };
  };
  return { write, writes };
}

const settings = () => db.prisma.ledgerSettings.findUniqueOrThrow({ where: { id: "main" } });
const ledgerAuditCount = () => db.prisma.auditLog.count({ where: { category: "ledger" } });

async function addLine(description: string, amount = "20") {
  const result = await runAs(master, () =>
    ledger.addLedgerEntryAction(
      form({ entryDate: todayDateOnlyString(), description, categoryId: fundraisingId, direction: "IN", amount, note: "" }),
    ),
  );
  assert.deepEqual(result, {});
}

describe("runLedgerSync", () => {
  it("does nothing when the Sheet isn't set up", async () => {
    assert.deepEqual(await sync.runLedgerSync({ reason: "auto" }), { status: "skipped", passes: 0 });
    assert.equal(await db.prisma.ledgerSettings.count(), 0);
  });

  it("writes the ledger, records how far it got, and lets go of the lease", async () => {
    await addLine("Popcorn sale deposit");
    await sync.markLedgerSyncRequested();
    const requested = (await settings()).syncRequestedAt;
    assert.ok(requested);
    const audits = await ledgerAuditCount();

    const sheet = fakeSheet();
    const result = await sync.runLedgerSync({ reason: "manual", write: sheet.write });
    assert.equal(result.status, "synced");
    assert.equal(result.passes, 1);
    assert.equal(sheet.writes.length, 1);
    assert.ok(JSON.stringify(sheet.writes[0].grid).includes("Popcorn sale deposit"));
    assert.deepEqual(sheet.writes[0].stored, { spreadsheetId: null, sheetTabId: null });

    const afterSync = await settings();
    assert.equal(afterSync.syncLeaseUntil, null);
    assert.ok(afterSync.syncedThrough && afterSync.syncedThrough.getTime() >= requested.getTime());
    assert.ok(afterSync.lastSyncedAt);
    assert.equal(afterSync.lastSyncError, null);
    assert.equal(afterSync.lastSyncRowCount, 1);
    assert.equal(afterSync.spreadsheetId, "TEST_spreadsheet_id_0123456789");
    assert.equal(afterSync.sheetTabId, 4242);
    assert.equal(await ledgerAuditCount(), audits, "the sync wrote no audit entry");

    // The next run is told where the tab is.
    const again = fakeSheet();
    await sync.runLedgerSync({ reason: "cron", write: again.write });
    assert.deepEqual(again.writes[0].stored, { spreadsheetId: "TEST_spreadsheet_id_0123456789", sheetTabId: 4242 });
  });

  it("is busy while another sync holds the lease, and runs once it has run out", async () => {
    await sync.markLedgerSyncRequested();
    await db.prisma.ledgerSettings.update({ where: { id: "main" }, data: { syncLeaseUntil: new Date(Date.now() + 60_000) } });
    const sheet = fakeSheet();
    assert.deepEqual(await sync.runLedgerSync({ reason: "auto", write: sheet.write }), { status: "busy", passes: 0 });
    assert.equal(sheet.writes.length, 0);
    assert.ok((await settings()).syncLeaseUntil, "someone else's lease is left alone");

    // A sync that died without letting go: its lease runs out.
    await db.prisma.ledgerSettings.update({ where: { id: "main" }, data: { syncLeaseUntil: new Date(Date.now() - 1_000) } });
    assert.equal((await sync.runLedgerSync({ reason: "auto", write: sheet.write })).status, "synced");
    assert.equal(sheet.writes.length, 1);
  });

  it("does another pass for a change saved while it was writing, and one sync at a time", async () => {
    await sync.markLedgerSyncRequested();
    let busyDuringWrite: string | null = null;
    const sheet = fakeSheet(async (call) => {
      if (call !== 1) return;
      // A save lands mid-write: it asks for a sync, finds this one running.
      await addLine("Mid-write deposit", "7");
      await sync.markLedgerSyncRequested();
      busyDuringWrite = (await sync.runLedgerSync({ reason: "auto", write: async () => assert.fail("ran twice at once") })).status;
    });
    const result = await sync.runLedgerSync({ reason: "auto", write: sheet.write });
    assert.equal(busyDuringWrite, "busy");
    assert.equal(result.passes, 2);
    assert.ok(JSON.stringify(sheet.writes[1].grid).includes("Mid-write deposit"));
    const afterSync = await settings();
    assert.ok(afterSync.syncedThrough! >= afterSync.syncRequestedAt!, "caught up");
    assert.equal(afterSync.syncLeaseUntil, null);
  });

  it("keeps a failure's short message and leaves the request pending", async () => {
    await sync.markLedgerSyncRequested();
    const before = await settings();
    const result = await sync.runLedgerSync({
      reason: "auto",
      write: async () => {
        throw new SheetsError("Google is busy; will retry", 429, true);
      },
    });
    assert.deepEqual(result, { status: "failed", passes: 1, error: "Google is busy; will retry" });
    const afterSync = await settings();
    assert.equal(afterSync.lastSyncError, "Google is busy; will retry");
    assert.equal(afterSync.syncedThrough?.getTime() ?? null, before.syncedThrough?.getTime() ?? null);
    assert.equal(afterSync.syncLeaseUntil, null);
    assert.equal((await sync.getLedgerSyncView()).behind, true);

    // An unexpected error is saved as a generic message, never its own text.
    const odd = await sync.runLedgerSync({
      reason: "auto",
      write: async () => {
        throw new Error("secret-ish internal detail");
      },
    });
    assert.equal(odd.status, "failed");
    assert.doesNotMatch((await settings()).lastSyncError ?? "", /secret-ish/);

    // A later success clears it.
    const sheet = fakeSheet();
    assert.equal((await sync.runLedgerSync({ reason: "manual", write: sheet.write })).status, "synced");
    assert.equal((await settings()).lastSyncError, null);
    assert.equal((await sync.getLedgerSyncView()).behind, false);
  });

  it("writes nothing while the Sheet copy is off", async () => {
    await runAs(treasurer, () => ledger.updateLedgerSettingsAction(form({ syncEnabled: "false" })));
    await sync.markLedgerSyncRequested();
    const sheet = fakeSheet();
    assert.deepEqual(await sync.runLedgerSync({ reason: "manual", write: sheet.write }), { status: "disabled", passes: 0 });
    assert.equal(sheet.writes.length, 0);
    assert.equal((await settings()).syncLeaseUntil, null);
  });

  it("never moves the request time backwards", async () => {
    await sync.markLedgerSyncRequested();
    const later = new Date(Date.now() + 3_600_000);
    await db.prisma.ledgerSettings.update({ where: { id: "main" }, data: { syncRequestedAt: later } });
    await sync.markLedgerSyncRequested();
    assert.equal((await settings()).syncRequestedAt?.getTime(), later.getTime());
  });
});

describe("asking for a sync after a save", () => {
  it("queues one sync per save once the Sheet is set up, and none before", async () => {
    await addLine("Before setup");
    assert.equal(testState.afterCallbacks.length, 0);

    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "ledger-sync@example-project.example.com";
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = await exportPKCS8(privateKey);
    process.env.GOOGLE_LEDGER_TEST_SPREADSHEET_ID = "TEST_spreadsheet_id_0123456789";
    await addLine("After setup");
    // Queued, not run here (running it would call Google).
    assert.equal(testState.afterCallbacks.length, 1);
    testState.afterCallbacks.length = 0;

    // A save that after() can't take still succeeds.
    testState.afterThrows = true;
    await addLine("after() unavailable");
    assert.equal(await db.prisma.ledgerEntry.count({ where: { description: "after() unavailable" } }), 1);
  });
});

describe("Sync now", () => {
  it("refuses a plain Admin, a Junior Admin and an anonymous visitor", async () => {
    await sync.markLedgerSyncRequested();
    const before = JSON.stringify(await settings());
    for (const [who, call] of [
      ["plain Admin", (fn: () => Promise<unknown>) => runAs(plainAdmin, fn)],
      ["Junior Admin", (fn: () => Promise<unknown>) => runAs(juniorAdmin, fn)],
      ["anonymous", async (fn: () => Promise<unknown>) => (await asAnonymous(fn)).result],
    ] as const) {
      const outcome = await settle(call(() => syncActions.syncLedgerNowAction()));
      assert.ok(!outcome.ok, `let the ${who} through`);
      assert.match(outcome.error.message, /Not authorized/);
    }
    assert.equal(JSON.stringify(await settings()), before);
  });

  it("tells a ledger account when the Sheet isn't set up", async () => {
    for (const user of [master, treasurer]) {
      const state = await runAs(user, () => syncActions.syncLedgerNowAction());
      assert.equal(state.status, "skipped");
      assert.match(state.message ?? "", /isn't set up/);
    }
  });
});
