import "dotenv/config";
import { defineConfig } from "prisma/config";

/*
 * Migrations connect with MIGRATION_DATABASE_URL when it is set (a separate
 * login allowed to change the schema), otherwise DATABASE_URL_UNPOOLED, as
 * before. The running site only ever uses DATABASE_URL (src/lib/prisma.ts).
 *
 * Read with process.env rather than prisma's env() helper, which throws when
 * the variable is missing — that made a plain `npm ci` (whose postinstall runs
 * `prisma generate`, which needs no database) fail on a fresh checkout without
 * a .env file. Commands that do need a database still fail with a clear
 * "datasource url" error when neither variable is set.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED,
    // Only needed locally for `prisma migrate diff`/`dev` against a migrations
    // directory; production `migrate deploy` never touches a shadow db, so this
    // is safely undefined there.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
