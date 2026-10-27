/*
 * Runs tests/db against a throwaway local Postgres.
 *
 *   TEST_DATABASE_URL=postgresql://postgres:…@127.0.0.1:54329/postgres npm run test:db [files…]
 *
 * TEST_DATABASE_URL is an admin connection to a LOCAL server (anything else is
 * refused). This script (re)creates a template database, applies every
 * migration to it with `prisma migrate deploy`, then runs the test files; each
 * file copies the template into its own database (tests/support/db.ts) and
 * drops it afterwards. It never reads DATABASE_URL from .env.
 */
import { spawnSync } from "node:child_process";
import pg from "pg";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
// Separate namespaces let several checkouts share one test server without
// dropping each other's databases (e.g. TEST_DB_NAMESPACE=wt_raffles).
const NAMESPACE = process.env.TEST_DB_NAMESPACE || "pack376";
if (!/^[a-z][a-z0-9_]{0,30}$/.test(NAMESPACE)) {
  console.error("TEST_DB_NAMESPACE must be lowercase letters, digits and underscores.");
  process.exit(1);
}
const TEMPLATE = `${NAMESPACE}_test_template`;

const raw = process.env.TEST_DATABASE_URL;
if (!raw) {
  console.error(
    "TEST_DATABASE_URL is not set. Point it at an admin login on a local, throwaway Postgres, e.g.\n" +
      "  TEST_DATABASE_URL=postgresql://postgres:password@127.0.0.1:5432/postgres npm run test:db",
  );
  process.exit(1);
}
const admin = new URL(raw);
if (!LOCAL_HOSTS.has(admin.hostname)) {
  console.error(`Refusing to run: TEST_DATABASE_URL host "${admin.hostname}" is not local.`);
  process.exit(1);
}

async function adminQuery(sql) {
  const client = new pg.Client({ connectionString: admin.href });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

// Leftovers from an interrupted earlier run.
const stale = await adminQuery(`SELECT datname FROM pg_database WHERE datname LIKE '${NAMESPACE.replace(/_/g, "\\_")}\\_t\\_%'`);
for (const { datname } of stale.rows) await adminQuery(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);

await adminQuery(`DROP DATABASE IF EXISTS "${TEMPLATE}" WITH (FORCE)`);
await adminQuery(`CREATE DATABASE "${TEMPLATE}"`);
const templateUrl = new URL(admin.href);
templateUrl.pathname = `/${TEMPLATE}`;

const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, MIGRATION_DATABASE_URL: templateUrl.href, DATABASE_URL_UNPOOLED: templateUrl.href },
});
if (migrate.status !== 0) {
  console.error("Migrating the test template database failed.");
  process.exit(migrate.status ?? 1);
}

const unsetUrl = new URL(admin.href);
unsetUrl.pathname = "/pack376_test_database_not_selected";

const files = process.argv.slice(2);
const test = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--import",
    "./tests/support/hooks.mjs",
    "--test",
    "--test-timeout=120000",
    ...(files.length ? files : ["tests/db/**/*.test.ts"]),
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "test",
      TEST_TEMPLATE_DB: TEMPLATE,
      TEST_DB_NAMESPACE: NAMESPACE,
      // Each test file points these at its own copy (tests/support/db.ts).
      // Until then they name a database that doesn't exist, so a stray value
      // from the shell can never reach the app under test.
      DATABASE_URL: unsetUrl.href,
      DATABASE_URL_UNPOOLED: unsetUrl.href,
    },
  },
);
process.exit(test.status ?? 1);
