/*
 * The daily Ledger sync cron route (src/app/api/cron/ledger-sync/route.ts):
 * refused without the exact CRON_SECRET bearer, refused outright when the
 * secret is missing or short, and only a status (never ledger data) in the
 * answer. The Google settings are unset here, so an allowed call is
 * "skipped" without touching the database or Google.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

const NAMES = [
  "CRON_SECRET",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
  "GOOGLE_LEDGER_SPREADSHEET_ID",
  "GOOGLE_LEDGER_TEST_SPREADSHEET_ID",
] as const;
const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));
const SECRET = "test-only-cron-secret-0123456789abcdef";

let GET: typeof import("@/app/api/cron/ledger-sync/route").GET;

before(async () => {
  for (const name of NAMES) delete process.env[name];
  ({ GET } = await import("@/app/api/cron/ledger-sync/route"));
});
after(() => {
  for (const name of NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

function call(authorization?: string) {
  const headers = authorization === undefined ? undefined : { authorization };
  return GET(new Request("https://portal.example.test/api/cron/ledger-sync", { headers }));
}

describe("ledger sync cron route", () => {
  it("refuses everyone while CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    for (const header of [undefined, "", "Bearer ", "Bearer undefined"]) {
      const response = await call(header);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  });

  it("refuses a short CRON_SECRET even when the header matches", async () => {
    process.env.CRON_SECRET = "short-secret";
    assert.equal((await call("Bearer short-secret")).status, 401);
  });

  it("refuses a missing or wrong bearer", async () => {
    process.env.CRON_SECRET = SECRET;
    for (const header of [undefined, SECRET, `Bearer ${SECRET}x`, `bearer ${SECRET}`, `Bearer ${SECRET.slice(0, -1)}`]) {
      assert.equal((await call(header)).status, 401, String(header));
    }
  });

  it("runs the sync for the right bearer, answering only its status", async () => {
    process.env.CRON_SECRET = SECRET;
    const response = await call(`Bearer ${SECRET}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { status: "skipped" });
  });
});
