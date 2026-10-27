/*
 * Lists any guarded database checks a migration skipped (see
 * scripts/schema-guards.mjs). Uses MIGRATION_DATABASE_URL, else
 * DATABASE_URL_UNPOOLED, else DATABASE_URL. Exits 1 if any are missing.
 *
 *   MIGRATION_DATABASE_URL=… node scripts/check-schema-guards.mjs
 */
import { reportSchemaGuards } from "./schema-guards.mjs";

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const missing = await reportSchemaGuards(url);
process.exit(missing && missing.length === 0 ? 0 : 1);
