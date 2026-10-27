/*
 * Shared setup for the raffle tests (raffle-*.test.ts). Each test file still
 * gets its own database through withTestDatabase(); these helpers take it.
 *
 * Two ways the race tests hold one change "in flight" while another starts:
 *
 *  - holdRaffle()/openTransaction(): a transaction on a second connection that
 *    does what the other action's transaction would — lock the raffle row,
 *    then write — and stays open. It stands in for an action paused between
 *    its writes and its commit. Variants that write a row without the raffle
 *    lock show the conditional writes refusing on their own.
 *  - pauseUser(): locks a user's row FOR UPDATE on a second connection. Every
 *    raffle action writes its audit entry (and a payment its recordedByUserId)
 *    inside its transaction, and those inserts take a key-share lock on the
 *    acting user's row for the foreign key check. So the REAL action, run as
 *    that user, stops there — holding the raffle lock, with its own changes
 *    written but not committed — until the test releases it. That lets two
 *    real actions race with a known order.
 */
import assert from "node:assert/strict";
import { openTransaction, type TestDatabase } from "../support/db";
import { form, runAs, settle, type SessionUser } from "../support/context";
import type { Role } from "@/generated/prisma/enums";

export type RaffleActions = typeof import("@/lib/actions/raffles");
export type RaffleResult = { error?: string };

export type TestUser = SessionUser & { id: string; username: string; displayName: string };

export function raffleTestKit(db: TestDatabase) {
  let counter = 0;
  const unique = (prefix: string) => `${prefix}-${++counter}-${Math.random().toString(36).slice(2, 8)}`;

  async function makeUser(role: Role, options: { raffleHelper?: boolean; username?: string } = {}): Promise<TestUser> {
    const username = options.username ?? unique(role.toLowerCase());
    const user = await db.prisma.user.create({
      data: {
        username,
        passwordHash: "x",
        role,
        displayName: `${username} (test)`,
        raffleHelper: options.raffleHelper ?? false,
      },
    });
    return { id: user.id, role: user.role, sessionVersion: user.sessionVersion, displayName: user.displayName, username };
  }

  async function makeRaffle(data: { boxCount?: number; priceCents?: number; prizePercent?: number; name?: string } = {}) {
    return db.prisma.raffle.create({
      data: { name: data.name ?? unique("Raffle"), boxCount: data.boxCount ?? 100, priceCents: data.priceCents ?? 1000, prizePercent: data.prizePercent ?? 50 },
    });
  }

  /** Runs a raffle action as `user`, settled so a rejection can't go unhandled while the test waits. */
  function act<T>(user: TestUser, fn: () => Promise<T>) {
    return settle(runAs(user, fn));
  }

  /** The action's { error } result, failing the test if it threw instead. */
  async function resultOf(pending: Promise<{ ok: true; value: RaffleResult } | { ok: false; error: Error }>) {
    const settled = await pending;
    if (!settled.ok) throw settled.error;
    return settled.value;
  }

  /** Waits until at least `count` other backends in this database are waiting on a lock. */
  async function waitForWaiters(count: number, timeoutMs = 5000) {
    const started = Date.now();
    for (;;) {
      const { rows } = await db.pool.query(
        `SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
      );
      if (rows[0].waiting >= count) return;
      if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${count} backend(s) to block on a lock`);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }

  /** Holds `user`'s row so that user's next raffle action stops just before its commit (see the note above). */
  async function pauseUser(user: TestUser) {
    const holder = await openTransaction(db.pool);
    await holder.query(`SELECT 1 FROM "User" WHERE id = $1 FOR UPDATE`, [user.id]);
    return holder;
  }

  /** A transaction holding the raffle's row lock, as a raffle action does from its first statement. */
  async function holdRaffle(raffleId: string) {
    const holder = await openTransaction(db.pool);
    await holder.query(`SELECT id FROM "Raffle" WHERE id = $1 FOR UPDATE`, [raffleId]);
    return holder;
  }

  async function boardOf(raffleId: string) {
    const boxes = await db.prisma.raffleBox.findMany({
      where: { raffleId },
      select: { number: true, entry: { select: { name: true } } },
      orderBy: { number: "asc" },
    });
    return boxes.map((box) => `${box.number}:${box.entry.name}`);
  }

  async function auditCount(action: string, entityId?: string) {
    return db.prisma.auditLog.count({ where: { action, ...(entityId ? { entityId } : {}) } });
  }

  /** Sells boxes as `user` and insists it worked. */
  async function sell(
    user: TestUser,
    actions: RaffleActions,
    raffleId: string,
    name: string,
    boxes: string,
    paid = "",
  ) {
    const result = await runAs(user, () => actions.assignBoxesAction(form({ raffleId, name, boxes, paid })));
    assert.deepEqual(result, {}, `selling ${boxes} to ${name}`);
    const entry = await db.prisma.raffleEntry.findFirstOrThrow({ where: { raffleId, name } });
    return entry;
  }

  return { unique, makeUser, makeRaffle, act, resultOf, waitForWaiters, pauseUser, holdRaffle, boardOf, auditCount, sell };
}

/** An id for a row a test inserts with raw SQL (the app's own rows get cuids). */
export function newId(prefix: string) {
  return `${prefix}${Math.random().toString(36).slice(2, 12)}`;
}

export { form };
