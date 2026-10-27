/*
 * Checks the real-database harness itself: a per-file database copy, real
 * session checks through runAs(), and a second independent connection.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { openTransaction, withTestDatabase, waitForLockWait } from "../support/db";
import { runAs } from "../support/context";

const db = withTestDatabase("harness");
let auth: typeof import("@/lib/auth");

before(async () => {
  await db.ready;
  auth = await import("@/lib/auth");
});

describe("test harness", () => {
  it("uses its own database copy with every migration applied", async () => {
    const { rows } = await db.pool.query(`SELECT current_database() AS name, count(*)::int AS migrations FROM "_prisma_migrations"`);
    assert.match(rows[0].name, /^pack376_t_harness_/);
    assert.ok(rows[0].migrations > 0);
  });

  it("runs getSession's real checks, including revocation", async () => {
    const user = await db.prisma.user.create({
      data: { username: "harness-admin", passwordHash: "x", role: "ADMIN", displayName: "Harness" },
    });
    const session = await runAs(user, () => auth.getSession());
    assert.equal(session?.userId, user.id);

    await db.prisma.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
    assert.equal(await runAs(user, () => auth.getSession()), null, "a stale sessionVersion is refused");
  });

  it("can hold a row lock on a second connection while the app waits", async (t) => {
    const user = await db.prisma.user.create({
      data: { username: "harness-lock", passwordHash: "x", role: "ADMIN", displayName: "Lock" },
    });
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(`SELECT id FROM "User" WHERE id = $1 FOR UPDATE`, [user.id]);
    // .then() starts the (lazy) Prisma query now rather than at the await below.
    const waiting = db.prisma.user.update({ where: { id: user.id }, data: { displayName: "After" } }).then((u) => u);
    await waitForLockWait(db.pool);
    await holder.query(`UPDATE "User" SET "displayName" = 'Holder' WHERE id = $1`, [user.id]);
    await holder.commit();
    await waiting;
    const final = await db.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(final.displayName, "After");
  });
});
