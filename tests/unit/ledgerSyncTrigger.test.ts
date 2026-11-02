/*
 * requestLedgerSync() (src/lib/ledgerSyncTrigger.ts) runs after every ledger
 * save, so it must never throw: not when after() throws (outside a Next.js
 * request), not when the Google settings are missing or malformed. When the
 * Sheet is set up it queues exactly one after() callback. The key is made
 * fresh for the run; every value is invented.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { exportPKCS8, generateKeyPair } from "jose";
import { resetTestState, testState } from "../support/context";
import { requestLedgerSync } from "@/lib/ledgerSyncTrigger";

const NAMES = [
  "VERCEL_ENV",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
  "GOOGLE_LEDGER_SPREADSHEET_ID",
  "GOOGLE_LEDGER_TEST_SPREADSHEET_ID",
] as const;
const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));
let pem = "";

function setEnv(values: Partial<Record<(typeof NAMES)[number], string>>) {
  for (const name of NAMES) delete process.env[name];
  Object.assign(process.env, values);
}

before(async () => {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  pem = await exportPKCS8(privateKey);
});
beforeEach(() => resetTestState());
after(() => {
  for (const name of NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

const configured = () => ({
  GOOGLE_SERVICE_ACCOUNT_EMAIL: "ledger-sync@example-project.example.com",
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: `"${pem.replace(/\n/g, "\\n")}"`,
  GOOGLE_LEDGER_TEST_SPREADSHEET_ID: "TEST_spreadsheet_id_0123456789",
});

describe("requestLedgerSync", () => {
  it("does nothing when the Sheet isn't set up", () => {
    setEnv({});
    requestLedgerSync();
    assert.equal(testState.afterCallbacks.length, 0);
  });

  it("does nothing, without throwing, when the settings are malformed", () => {
    for (const env of [
      { ...configured(), GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "garbage" },
      { ...configured(), GOOGLE_LEDGER_TEST_SPREADSHEET_ID: "../../x?y" },
      { ...configured(), GOOGLE_SERVICE_ACCOUNT_EMAIL: "" },
      // Outside production the real spreadsheet ID alone is never used.
      { ...configured(), GOOGLE_LEDGER_TEST_SPREADSHEET_ID: "", GOOGLE_LEDGER_SPREADSHEET_ID: "REAL_spreadsheet_id_0123456789" },
    ]) {
      setEnv(env);
      assert.doesNotThrow(() => requestLedgerSync());
    }
    assert.equal(testState.afterCallbacks.length, 0);
  });

  it("queues one after() callback when the Sheet is set up", () => {
    setEnv(configured());
    requestLedgerSync();
    assert.equal(testState.afterCallbacks.length, 1);
  });

  it("never throws when after() throws", () => {
    setEnv(configured());
    testState.afterThrows = true;
    assert.doesNotThrow(() => requestLedgerSync());
    assert.equal(testState.afterCallbacks.length, 0);
  });
});
