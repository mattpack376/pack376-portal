/*
 * Real-Postgres support for tests/db. `npm run test:db` (scripts/test-db.mjs)
 * migrates a template database once; each test file then gets its own copy:
 *
 *   const db = withTestDatabase("raffles");
 *   let raffles: typeof import("@/lib/actions/raffles");
 *   before(async () => {
 *     await db.ready;
 *     raffles = await import("@/lib/actions/raffles");
 *   });
 *
 * The app's Prisma client reads DATABASE_URL when src/lib/prisma.ts is first
 * imported, so app modules must be imported (dynamically) only after
 * `db.ready` — Node runs a file's top-level before() hooks concurrently, so
 * hook order alone does not guarantee the copy exists yet.
 *
 * db.pool is a separate pg pool: use it for a second, independent connection,
 * e.g. to hold a row lock in an open transaction while an action runs.
 *
 * Prisma queries are lazy: a bare `prisma.x.update(...)` does nothing until it
 * is awaited or `.then()`ed. Server Actions are ordinary async functions, so
 * calling one starts it straight away.
 */
import { after, before } from "node:test";
import { randomBytes } from "node:crypto";
import pg from "pg";
import type { PrismaClient } from "@/generated/prisma/client";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Refuses anything but a database server on this machine. */
export function assertLocalDatabaseUrl(raw: string | undefined, name: string): URL {
  if (!raw) throw new Error(`${name} is not set — run DB tests through \`npm run test:db\`.`);
  const url = new URL(raw);
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`${name} must point at a local throwaway Postgres (got host "${url.hostname}").`);
  }
  return url;
}

function withDatabase(base: URL, database: string) {
  const url = new URL(base.href);
  url.pathname = `/${database}`;
  return url.href;
}

async function adminQuery(sql: string) {
  const admin = assertLocalDatabaseUrl(process.env.TEST_DATABASE_URL, "TEST_DATABASE_URL");
  const client = new pg.Client({ connectionString: admin.href });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

export type TestDatabase = {
  /** Resolves once the copy exists and DATABASE_URL points at it. */
  readonly ready: Promise<void>;
  readonly url: string;
  readonly pool: pg.Pool;
  readonly prisma: PrismaClient;
};

export function withTestDatabase(label: string): TestDatabase {
  const template = process.env.TEST_TEMPLATE_DB;
  const name = `pack376_t_${label.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_${randomBytes(4).toString("hex")}`;
  let url = "";
  let pool: pg.Pool | null = null;
  let prisma: PrismaClient | null = null;
  let markReady!: () => void;
  let markFailed!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    markFailed = reject;
  });
  // Rejections are reported by the hook itself; don't also crash on an
  // unawaited `ready`.
  ready.catch(() => {});

  before(async () => {
    try {
      await setUp();
      markReady();
    } catch (error) {
      markFailed(error);
      throw error;
    }
  });

  async function setUp() {
    if (!template) throw new Error("TEST_TEMPLATE_DB is not set — run DB tests through `npm run test:db`.");
    const admin = assertLocalDatabaseUrl(process.env.TEST_DATABASE_URL, "TEST_DATABASE_URL");
    // CREATE DATABASE … TEMPLATE fails while another session is copying the
    // same template; test files start in parallel, so retry briefly.
    for (let attempt = 0; ; attempt++) {
      try {
        await adminQuery(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
        break;
      } catch (error) {
        if (attempt >= 40 || !/being accessed by other users/.test(String(error))) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 200));
      }
    }
    url = withDatabase(admin, name);
    process.env.DATABASE_URL = url;
    process.env.DATABASE_URL_UNPOOLED = url;
    pool = new pg.Pool({ connectionString: url, max: 10 });
    pool.on("error", () => {}); // idle connections ended by the final DROP
    prisma = (await import("@/lib/prisma")).prisma;
  }

  after(async () => {
    // Close normally first; a client a failed test left mid-transaction can
    // keep that waiting, so give up after a few seconds — the FORCE drop
    // below ends any connection still open (their errors are ignored).
    const closing = Promise.allSettled([prisma?.$disconnect(), pool?.end()]);
    await Promise.race([closing, new Promise((resolve) => setTimeout(resolve, 3000))]);
    if (url) await adminQuery(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  });

  return {
    ready,
    get url() {
      return url;
    },
    get pool() {
      if (!pool) throw new Error("Test database not ready yet (use it inside a test or a later before() hook).");
      return pool;
    },
    get prisma() {
      if (!prisma) throw new Error("Test database not ready yet (use it inside a test or a later before() hook).");
      return prisma;
    },
  };
}

/**
 * Opens a transaction on its own connection and returns controls for it. Use
 * it to hold locks or uncommitted writes while an action runs concurrently.
 */
export async function openTransaction(pool: pg.Pool) {
  const client = await pool.connect();
  client.on("error", () => {}); // ended by the final DROP if a test never finished it
  await client.query("BEGIN");
  let done = false;
  return {
    query: (sql: string, params?: unknown[]) => client.query(sql, params),
    async commit() {
      if (done) return;
      done = true;
      try {
        await client.query("COMMIT");
      } finally {
        client.release();
      }
    },
    async rollback() {
      if (done) return;
      done = true;
      try {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    },
  };
}

/**
 * Resolves once some other backend in this database is waiting on a lock — the
 * signal that a concurrently started action has reached the point where it
 * must wait for the transaction a test is holding open.
 */
export async function waitForLockWait(pool: pg.Pool, timeoutMs = 5000) {
  const started = Date.now();
  for (;;) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
    );
    if (rows[0].waiting > 0) return;
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for a concurrent action to block on a lock");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
