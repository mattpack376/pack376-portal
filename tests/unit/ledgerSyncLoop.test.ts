/*
 * The Sheet sync's lease and coalescing rules (src/lib/ledgerSyncLoop.ts),
 * with an in-memory stand-in for the LedgerSettings row and a fake writer.
 * tests/db/ledgerSync.test.ts runs the same rules against the real SQL.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_SYNC_ERROR_LENGTH,
  isSyncBehind,
  runLedgerSyncLoop,
  type LedgerSyncPass,
  type LedgerSyncStore,
  type LedgerSyncWritten,
} from "@/lib/ledgerSyncLoop";
import type { StoredPortalTab } from "@/lib/googleSheets";

/** The settings row: a ticking clock, the request and synced-through times, and the lease. */
class MemoryStore implements LedgerSyncStore {
  clock = 1_000;
  requestedAt: number | null = null;
  syncedThrough: number | null = null;
  lease: string | null = null;
  enabled = true;
  lastError: string | null = null;
  lostLeaseOnRenew = Infinity;
  renewals = 0;
  onRelease: (() => void) | null = null;
  private seq = 0;

  /** A change committed and asked for a sync. */
  request() {
    this.requestedAt = ++this.clock;
  }

  async acquire() {
    if (this.lease) return null;
    this.lease = `lease-${++this.seq}`;
    return this.lease;
  }
  async renew(token: string) {
    this.renewals += 1;
    if (this.renewals >= this.lostLeaseOnRenew) this.lease = "someone-else";
    if (this.lease !== token) return null;
    this.lease = `lease-${++this.seq}`;
    const pass: LedgerSyncPass = {
      startedAt: new Date(++this.clock),
      syncRequestedAt: this.requestedAt === null ? null : new Date(this.requestedAt),
      syncedThrough: this.syncedThrough === null ? null : new Date(this.syncedThrough),
      syncEnabled: this.enabled,
      stored: { spreadsheetId: null, sheetTabId: null },
    };
    return { token: this.lease, pass };
  }
  async saveSuccess(token: string, done: LedgerSyncWritten & { syncedThrough: Date }) {
    if (token !== this.lease) return;
    this.syncedThrough = Math.max(this.syncedThrough ?? 0, done.syncedThrough.getTime());
    this.lastError = null;
  }
  async saveFailure(token: string, message: string) {
    if (token === this.lease) this.lastError = message;
  }
  async release(token: string) {
    if (token === this.lease) this.lease = null;
    const hook = this.onRelease;
    this.onRelease = null;
    hook?.();
  }
  async isBehind() {
    return this.enabled && isSyncBehind(this.requestedAt === null ? null : new Date(this.requestedAt), this.syncedThrough === null ? null : new Date(this.syncedThrough));
  }
}

function deps(store: MemoryStore, write: (stored: StoredPortalTab) => Promise<LedgerSyncWritten> | LedgerSyncWritten) {
  let writes = 0;
  return {
    get writes() {
      return writes;
    },
    deps: {
      store,
      signal: new AbortController().signal,
      describeError: (error: unknown) => (error instanceof Error ? error.message : "failed"),
      write: async (stored: StoredPortalTab) => {
        writes += 1;
        return write(stored);
      },
    },
  };
}

const WRITTEN: LedgerSyncWritten = { spreadsheetId: "TEST_sheet", sheetTabId: 7, rowCount: 3 };

describe("ledger sync loop", () => {
  it("writes once, covers the request, and lets go of the lease", async () => {
    const store = new MemoryStore();
    store.request();
    const run = deps(store, () => WRITTEN);
    const result = await runLedgerSyncLoop(run.deps);
    assert.deepEqual(result, { status: "synced", passes: 1, rowCount: 3 });
    assert.equal(run.writes, 1);
    assert.equal(store.lease, null);
    assert.equal(await store.isBehind(), false);
  });

  it("writes even with nothing asked for (Sync now, the daily run)", async () => {
    const store = new MemoryStore();
    const run = deps(store, () => WRITTEN);
    assert.equal((await runLedgerSyncLoop(run.deps)).status, "synced");
    assert.equal(run.writes, 1);
  });

  it("does another pass for a change saved while it was writing", async () => {
    const store = new MemoryStore();
    store.request();
    let first = true;
    const run = deps(store, () => {
      if (first) store.request(); // a save lands mid-write
      first = false;
      return WRITTEN;
    });
    const result = await runLedgerSyncLoop(run.deps);
    assert.equal(result.passes, 2);
    assert.equal(run.writes, 2);
    assert.equal(await store.isBehind(), false);
  });

  it("is busy while another sync holds the lease, and that one picks up the request", async () => {
    const store = new MemoryStore();
    store.request();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let started!: () => void;
    const writing = new Promise<void>((resolve) => (started = resolve));
    let calls = 0;
    const slow = deps(store, async () => {
      calls += 1;
      if (calls === 1) {
        started();
        await held;
      }
      return WRITTEN;
    });
    const running = runLedgerSyncLoop(slow.deps);
    await writing;

    // A second save while the first sync is writing.
    store.request();
    const other = deps(store, () => WRITTEN);
    assert.deepEqual(await runLedgerSyncLoop(other.deps), { status: "busy", passes: 0 });
    assert.equal(other.writes, 0);

    release();
    const result = await running;
    assert.equal(result.passes, 2);
    assert.equal(await store.isBehind(), false);
  });

  it("stops after three passes, then checks once more", async () => {
    const store = new MemoryStore();
    store.request();
    const run = deps(store, () => {
      store.request(); // a save during every write
      return WRITTEN;
    });
    const result = await runLedgerSyncLoop(run.deps);
    assert.equal(run.writes, 6);
    assert.equal(result.passes, 6);
    assert.equal(store.lease, null);
    // Still behind: the next save, page load or the daily run catches up.
    assert.equal(await store.isBehind(), true);
  });

  it("catches a request that comes in just as the lease is let go", async () => {
    const store = new MemoryStore();
    store.request();
    store.onRelease = () => store.request();
    const run = deps(store, () => WRITTEN);
    const result = await runLedgerSyncLoop(run.deps);
    assert.equal(run.writes, 2);
    assert.equal(result.passes, 2);
    assert.equal(await store.isBehind(), false);
  });

  it("saves a short failure message, keeps the request pending and lets go", async () => {
    const store = new MemoryStore();
    store.request();
    const run = deps(store, () => {
      throw new Error(`Google is busy; will retry ${"x".repeat(500)}`);
    });
    const result = await runLedgerSyncLoop(run.deps);
    assert.equal(result.status, "failed");
    assert.equal(result.error?.length, MAX_SYNC_ERROR_LENGTH);
    assert.equal(store.lastError?.length, MAX_SYNC_ERROR_LENGTH);
    assert.equal(store.lease, null);
    assert.equal(await store.isBehind(), true);
    assert.equal(run.writes, 1);
  });

  it("writes nothing while the copy is turned off", async () => {
    const store = new MemoryStore();
    store.enabled = false;
    store.request();
    const run = deps(store, () => WRITTEN);
    assert.deepEqual(await runLedgerSyncLoop(run.deps), { status: "disabled", passes: 0 });
    assert.equal(run.writes, 0);
    assert.equal(store.lease, null);
  });

  it("stops when its lease was taken over", async () => {
    const store = new MemoryStore();
    store.request();
    store.lostLeaseOnRenew = 2;
    const run = deps(store, () => {
      store.request();
      return WRITTEN;
    });
    const result = await runLedgerSyncLoop(run.deps);
    assert.equal(run.writes, 1);
    assert.equal(result.passes, 1);
    // The new holder's lease is left alone.
    assert.equal(store.lease, "someone-else");
  });

  it("compares request and sync times strictly", () => {
    const t = new Date(5_000);
    assert.equal(isSyncBehind(null, null), false);
    assert.equal(isSyncBehind(t, null), true);
    assert.equal(isSyncBehind(t, t), false);
    assert.equal(isSyncBehind(new Date(5_001), t), true);
  });
});
