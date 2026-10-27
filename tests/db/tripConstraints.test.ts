/*
 * The CHECK constraints from prisma/migrations/20261027140000_trip_money_checks:
 * present after migrating, refusing bad rows, and — since the migration
 * runs against production rows nobody has looked at — skipped with a notice
 * rather than failing the deploy when an existing row already breaks one.
 * `prisma migrate deploy` doesn't print notices, so the migration's header
 * gives a query to run after deploying; that query is checked here too.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { withTestDatabase } from "../support/db";
import { freshTrip } from "./tripHelpers";

const db = withTestDatabase("trip_constraints");
const MIGRATION = readFileSync(join(process.cwd(), "prisma/migrations/20261027140000_trip_money_checks/migration.sql"), "utf8");
const CONSTRAINTS = ["TripRegistration_pending_owes_nothing", "TripRegistration_amounts_nonnegative", "TripPage_prices_nonnegative"];

/** The post-deploy check the migration's header comment tells the admin to run, taken from the comment itself. */
const DOCUMENTED_CHECK = (() => {
  const found = /--\s+(SELECT conname FROM pg_constraint[\s\S]*?;)/.exec(MIGRATION);
  assert.ok(found, "the migration's header documents the post-deploy query");
  return found[1].replace(/\n--/g, "\n");
})();

async function documentedCheck() {
  const { rows } = await db.pool.query(DOCUMENTED_CHECK);
  return rows.map((r) => r.conname as string).sort();
}

before(async () => {
  await db.ready;
});

async function present() {
  const { rows } = await db.pool.query(`SELECT conname FROM pg_constraint WHERE conname = ANY($1) ORDER BY conname`, [CONSTRAINTS]);
  return rows.map((r) => r.conname as string);
}

/** Runs the migration's SQL on its own connection, returning the notices it raised. */
async function runMigration() {
  const client = await db.pool.connect();
  const notices: string[] = [];
  const onNotice = (notice: { message?: string }) => notices.push(notice.message ?? "");
  client.on("notice", onNotice);
  try {
    await client.query(MIGRATION);
  } finally {
    client.off("notice", onNotice);
    client.release();
  }
  return notices;
}

const insertRegistration = (tripPageId: string, values: { owedPending: boolean; amountOwedCents: number; payingCount?: number }) =>
  db.pool.query(
    `INSERT INTO "TripRegistration" ("id", "tripPageId", "familyName", "contactEmail", "affiliation", "payingCount", "freeCount", "amountOwedCents", "owedPending")
     VALUES (gen_random_uuid()::text, $1, 'Raw Row', 'raw@example.test', 'PACK', $2, 0, $3, $4) RETURNING "id"`,
    [tripPageId, values.payingCount ?? 1, values.amountOwedCents, values.owedPending],
  );

describe("trip money constraints", () => {
  it("are in place after migrating, and refuse rows the actions never write", async () => {
    assert.deepEqual(await present(), [...CONSTRAINTS].sort());
    assert.deepEqual(await documentedCheck(), [...CONSTRAINTS].sort(), "the documented check finds all three");
    const trip = await freshTrip(db.prisma);

    await assert.rejects(insertRegistration(trip.id, { owedPending: true, amountOwedCents: 500 }), /TripRegistration_pending_owes_nothing/);
    await assert.rejects(insertRegistration(trip.id, { owedPending: false, amountOwedCents: -500 }), /TripRegistration_amounts_nonnegative/);
    await assert.rejects(
      insertRegistration(trip.id, { owedPending: false, amountOwedCents: 0, payingCount: -1 }),
      /TripRegistration_amounts_nonnegative/,
    );
    await assert.rejects(
      db.pool.query(`UPDATE "TripPage" SET "earlyBirdPriceCents" = -1 WHERE "id" = $1`, [trip.id]),
      /TripPage_prices_nonnegative/,
    );

    // What the actions do write is fine: waiting at $0, a free event, a charged row.
    await insertRegistration(trip.id, { owedPending: true, amountOwedCents: 0 });
    await insertRegistration(trip.id, { owedPending: false, amountOwedCents: 0 });
    await insertRegistration(trip.id, { owedPending: false, amountOwedCents: 4000 });
  });

  it("are skipped with a notice, not a failed deploy, when an existing row already breaks one", async () => {
    const trip = await freshTrip(db.prisma);
    await db.pool.query(`ALTER TABLE "TripRegistration" DROP CONSTRAINT "TripRegistration_pending_owes_nothing"`);
    const { rows } = await insertRegistration(trip.id, { owedPending: true, amountOwedCents: 500 });

    const notices = await runMigration();
    assert.ok(notices.some((n) => n.includes("Skipped TripRegistration_pending_owes_nothing")), notices.join("\n"));
    assert.deepEqual(await present(), ["TripPage_prices_nonnegative", "TripRegistration_amounts_nonnegative"]);
    assert.deepEqual(await documentedCheck(), await present(), "the documented check shows which one is missing");

    // Fixed by hand, the same block adds it — and leaves the others alone.
    await db.pool.query(`UPDATE "TripRegistration" SET "amountOwedCents" = 0 WHERE "id" = $1`, [rows[0].id]);
    assert.deepEqual(await runMigration(), []);
    assert.deepEqual(await present(), [...CONSTRAINTS].sort());
    assert.deepEqual(await documentedCheck(), [...CONSTRAINTS].sort());
  });
});
