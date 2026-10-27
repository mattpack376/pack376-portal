/*
 * Database checks that some migrations add only when existing rows already
 * satisfy them. Rather than fail a production deploy over one odd old row,
 * those migrations skip the check and RAISE a NOTICE — which `prisma migrate
 * deploy` doesn't print. checkSchemaGuards() reports any that are missing so
 * the release log says so (scripts/vercel-build.mjs runs it after
 * migrating; `node scripts/check-schema-guards.mjs` runs it by hand).
 *
 * tests/unit/schemaGuards.test.ts fails if a migration adds a guarded check
 * that isn't listed here.
 */
import pg from "pg";

export const GUARDED_CONSTRAINTS = [
  // 20261027130001_raffle_check_constraints
  "Raffle_terms_check",
  "Raffle_drawing_check",
  "RaffleBox_number_check",
  "RafflePayment_amountCents_check",
  // 20261027140000_trip_money_checks
  "TripPage_prices_nonnegative",
  "TripRegistration_amounts_nonnegative",
  "TripRegistration_pending_owes_nothing",
  // 20261027150001_limit_username_length
  "User_username_length_check",
  // 20261027160000_guest_group_submission_key
  "EventGuestGroup_nonnegative_check",
];

export const GUARDED_INDEXES = [
  // 20261027130000_raffle_buyer_name_unique
  "RaffleEntry_raffleId_name_key",
];

/** Names from the lists above that the database doesn't have. */
export async function missingSchemaGuards(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const constraints = await client.query(
      `SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[])`,
      [GUARDED_CONSTRAINTS],
    );
    const indexes = await client.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ANY($1::text[])`,
      [GUARDED_INDEXES],
    );
    const present = new Set([...constraints.rows.map((r) => r.conname), ...indexes.rows.map((r) => r.indexname)]);
    return [...GUARDED_CONSTRAINTS, ...GUARDED_INDEXES].filter((name) => !present.has(name));
  } finally {
    await client.end();
  }
}

/**
 * Logs the result. Never throws and never fails the build: the app checks
 * the same rules itself, so a skipped database check is a gap to close, not
 * an outage.
 *
 * @param {string | undefined} connectionString
 * @param {{ log(message: string): void; warn(message: string): void }} [log]
 * @returns {Promise<string[] | null>} missing names, or null if it couldn't check
 */
export async function reportSchemaGuards(connectionString, log = console) {
  if (!connectionString) {
    log.warn("[schema guards] no database URL set, so the guarded checks weren't verified.");
    return null;
  }
  try {
    const missing = await missingSchemaGuards(connectionString);
    if (missing.length === 0) {
      log.log(`[schema guards] all ${GUARDED_CONSTRAINTS.length + GUARDED_INDEXES.length} guarded database checks are in place.`);
    } else {
      log.warn(
        `[schema guards] WARNING: ${missing.length} database check(s) were skipped because existing rows break them: ` +
          `${missing.join(", ")}. The app still enforces these rules; see docs/security-operations.md §1.1 to fix the rows and add them.`,
      );
    }
    return missing;
  } catch (error) {
    log.warn(`[schema guards] couldn't verify the guarded database checks: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}
