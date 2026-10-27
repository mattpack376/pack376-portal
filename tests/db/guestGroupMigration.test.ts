/*
 * The guest-group submission key migration has to apply to the live
 * database whatever rows are already there: the new column is NULL for every
 * existing row (NULLs never collide in the unique index), and the
 * non-negative CHECK is skipped with a notice, not a failed deploy, if some
 * old row would break it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { before, describe, it } from "node:test";
import { withTestDatabase } from "../support/db";
import { packFixtures } from "./fixtures/pack";

const MIGRATION = new URL(
  "../../prisma/migrations/20261027160000_guest_group_submission_key/migration.sql",
  import.meta.url,
);

const db = withTestDatabase("guest_group_migration");
let fx: ReturnType<typeof packFixtures>;

before(async () => {
  await db.ready;
  fx = packFixtures(db.prisma);
});

async function constraintExists() {
  const { rows } = await db.pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = 'EventGuestGroup_nonnegative_check'`,
  );
  return rows.length === 1;
}

async function keyIndexExists() {
  const { rows } = await db.pool.query(
    `SELECT 1 FROM pg_indexes WHERE indexname = 'EventGuestGroup_submissionKey_key'`,
  );
  return rows.length === 1;
}

/** Puts the table back to how it was before this migration. */
async function undoMigration() {
  await db.pool.query(`
    ALTER TABLE "EventGuestGroup" DROP CONSTRAINT IF EXISTS "EventGuestGroup_nonnegative_check";
    DROP INDEX IF EXISTS "EventGuestGroup_submissionKey_key";
    ALTER TABLE "EventGuestGroup" DROP COLUMN IF EXISTS "submissionKey";
  `);
}

/** Runs the migration file the way `prisma migrate deploy` does: one script, one transaction. */
async function applyMigration() {
  const client = await db.pool.connect();
  const notices: string[] = [];
  const onNotice = (notice: { message?: string }) => notices.push(notice.message ?? "");
  client.on("notice", onNotice);
  try {
    await client.query("BEGIN");
    await client.query(readFileSync(MIGRATION, "utf8"));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.off("notice", onNotice);
    client.release();
  }
  return notices;
}

async function insertGroup(eventId: string, adultCount: number) {
  await db.pool.query(
    `INSERT INTO "EventGuestGroup" (id, "eventId", "familyName", "adultCount", "childCount", "amountOwedCents")
     VALUES ($1, $2, 'Old row', $3, 0, 0)`,
    [`old-${randomUUID()}`, eventId, adultCount],
  );
}

describe("guest group submission key migration", () => {
  it("is applied in the test template: the column, its unique index and the CHECK", async () => {
    assert.ok(await keyIndexExists());
    assert.ok(await constraintExists());
    const event = await fx.event();
    await assert.rejects(insertGroup(event.id, -1), (error: { code?: string }) => error.code === "23514");
  });

  it("applies over existing rows, leaving their keys NULL", async () => {
    const event = await fx.event();
    await undoMigration();
    await insertGroup(event.id, 2);
    await insertGroup(event.id, 3);

    const notices = await applyMigration();
    assert.deepEqual(notices, []);
    assert.ok(await keyIndexExists());
    assert.ok(await constraintExists());
    const { rows } = await db.pool.query(
      `SELECT count(*)::int AS n FROM "EventGuestGroup" WHERE "eventId" = $1 AND "submissionKey" IS NULL`,
      [event.id],
    );
    assert.equal(rows[0].n, 2);
  });

  it("skips the CHECK with a notice, rather than failing, when an old row would break it", async () => {
    const event = await fx.event();
    await undoMigration();
    await insertGroup(event.id, -1);

    const notices = await applyMigration();
    assert.equal(notices.length, 1);
    assert.match(notices[0], /skipped adding EventGuestGroup_nonnegative_check/);
    assert.ok(await keyIndexExists());
    assert.equal(await constraintExists(), false);

    // Put this copy back the way every other test expects it.
    await db.pool.query(`DELETE FROM "EventGuestGroup" WHERE "adultCount" < 0`);
    await undoMigration();
    await applyMigration();
    assert.ok(await constraintExists());
  });
});
