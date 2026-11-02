/*
 * The Ledger's Google Sheets client (src/lib/googleSheets.ts) against a fake
 * Google: fetch is injected, and the service-account key is made fresh for
 * each run (never stored anywhere). Checks the sign-in JWT, the token cache,
 * how a pasted key is cleaned up, that writes only ever reach the portal's
 * own marked tab, and that error messages and logs never carry the key, the
 * signed JWT, the token or Google's reply.
 *
 * Every email, ID and value here is invented.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { exportPKCS8, exportSPKI, generateKeyPair, decodeProtectedHeader, jwtVerify, importSPKI } from "jose";
import {
  PORTAL_TAB_COLUMNS,
  PORTAL_TAB_METADATA_KEY,
  PORTAL_TAB_TITLE,
  SheetsError,
  UNTAGGED_TAB_MESSAGE,
  choosePortalTab,
  clearSheetsTokenCache,
  listTabs,
  readTabValues,
  writePortalLedgerTab,
  type SheetGrid,
} from "@/lib/googleSheets";
import { isSheetsConfigured, normalizePrivateKey, readSheetsConfig, type SheetsConfig } from "@/lib/googleSheetsConfig";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const EMAIL = "ledger-sync@example-project.example.com";
const SPREADSHEET_ID = "TEST_spreadsheet_id_0123456789";
const ACCESS_TOKEN = "ya29.fake-access-token-for-tests";
/** Text in Google's (fake) error replies; must never surface. */
const BODY_SECRET = "raw-google-body-detail-7f3a";

let pem = "";
let publicPem = "";
let config: SheetsConfig;

before(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  pem = await exportPKCS8(privateKey);
  publicPem = await exportSPKI(publicKey);
  config = { email: EMAIL, privateKey: pem, spreadsheetId: SPREADSHEET_ID, production: false };
});

beforeEach(() => clearSheetsTokenCache());

type Call = { url: string; method: string; body: string | null; headers: Headers };
type Reply = { status: number; body: unknown };

function tab(sheetId: number, title: string, tagged = false, metadataSheetId = sheetId) {
  return {
    properties: { sheetId, title, gridProperties: { rowCount: 1000, columnCount: 26 } },
    developerMetadata: tagged
      ? [
          {
            metadataId: 9,
            metadataKey: PORTAL_TAB_METADATA_KEY,
            metadataValue: "1",
            location: { locationType: "SHEET", sheetId: metadataSheetId },
            visibility: "DOCUMENT",
          },
        ]
      : [],
  };
}

/** A fake Google: answers the token, tab-list, values and batchUpdate calls, and records them. */
function fakeGoogle(options: { tabs?: unknown[]; token?: Reply; list?: Reply; batch?: Reply; values?: unknown[][]; throws?: Error } = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : null,
      headers: new Headers(init?.headers),
    });
    if (options.throws) throw options.throws;
    const respond = ({ status, body }: Reply) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (url === TOKEN_URL) return respond(options.token ?? { status: 200, body: { access_token: ACCESS_TOKEN, expires_in: 3600 } });
    if (url.includes(":batchUpdate")) return respond(options.batch ?? { status: 200, body: { replies: [] } });
    if (url.includes("/values/")) return respond({ status: 200, body: { values: options.values ?? [] } });
    return respond(options.list ?? { status: 200, body: { sheets: options.tabs ?? [] } });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

const GRID: SheetGrid = {
  rows: [
    { values: [{ userEnteredValue: { stringValue: "Title" } }] },
    { values: [{ userEnteredValue: { stringValue: "Date" } }, { userEnteredValue: { stringValue: "Description" } }] },
    { values: [{ userEnteredValue: { numberValue: 46023 } }, { userEnteredValue: { stringValue: "=1+1" } }] },
  ],
  frozenRowCount: 2,
};

/** Every sheetId mentioned anywhere in a request body. */
function sheetIdsIn(value: unknown, found: number[] = []): number[] {
  if (Array.isArray(value)) value.forEach((v) => sheetIdsIn(v, found));
  else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      if (key === "sheetId" && typeof v === "number") found.push(v);
      else sheetIdsIn(v, found);
    }
  }
  return found;
}

function batchCalls(calls: Call[]) {
  return calls.filter((c) => c.url.includes(":batchUpdate"));
}

describe("configuration", () => {
  it("cleans up a pasted key: quotes, literal \\n and spaces", () => {
    const pasted = `  "${pem.trim().replace(/\n/g, "\\n")}"  `;
    assert.equal(normalizePrivateKey(pasted), pem.trim());
    assert.equal(normalizePrivateKey(`'${pem.trim()}'`), pem.trim());
    // Only one pair of quotes, and only matching ones.
    assert.equal(normalizePrivateKey(`"abc'`), `"abc'`);
  });

  it("uses only the test spreadsheet outside production, and only the real one in production", () => {
    const base = { GOOGLE_SERVICE_ACCOUNT_EMAIL: EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: pem.replace(/\n/g, "\\n") };
    const real = "REAL_spreadsheet_id_0123456789";
    assert.equal(readSheetsConfig({ ...base, GOOGLE_LEDGER_SPREADSHEET_ID: real }), null);
    assert.equal(readSheetsConfig({ ...base, VERCEL_ENV: "preview", GOOGLE_LEDGER_SPREADSHEET_ID: real }), null);
    assert.equal(
      readSheetsConfig({ ...base, VERCEL_ENV: "preview", GOOGLE_LEDGER_SPREADSHEET_ID: real, GOOGLE_LEDGER_TEST_SPREADSHEET_ID: SPREADSHEET_ID })
        ?.spreadsheetId,
      SPREADSHEET_ID,
    );
    const production = readSheetsConfig({
      ...base,
      VERCEL_ENV: "production",
      GOOGLE_LEDGER_SPREADSHEET_ID: real,
      GOOGLE_LEDGER_TEST_SPREADSHEET_ID: SPREADSHEET_ID,
    });
    assert.equal(production?.spreadsheetId, real);
    assert.equal(production?.privateKey, pem.trim());
    assert.equal(production?.production, true);
  });

  it("treats missing or malformed settings as not set up, without throwing", () => {
    const good = {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: EMAIL,
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: pem,
      GOOGLE_LEDGER_TEST_SPREADSHEET_ID: SPREADSHEET_ID,
    };
    assert.equal(isSheetsConfigured(good), true);
    assert.equal(isSheetsConfigured({}), false);
    assert.equal(isSheetsConfigured({ ...good, GOOGLE_SERVICE_ACCOUNT_EMAIL: "not an email" }), false);
    assert.equal(isSheetsConfigured({ ...good, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "just some text" }), false);
    assert.equal(isSheetsConfigured({ ...good, GOOGLE_LEDGER_TEST_SPREADSHEET_ID: "../../other?x=1" }), false);
  });

  it("refuses to call Google at all when not set up", async () => {
    const google = fakeGoogle();
    await assert.rejects(listTabs({ config: null, fetch: google.fetch }), (error: unknown) => {
      assert.ok(error instanceof SheetsError);
      assert.match(error.message, /isn't set up/);
      return true;
    });
    assert.equal(google.calls.length, 0);
  });
});

describe("signing in", () => {
  it("sends a service-account JWT with the right claims, signed RS256", async () => {
    const google = fakeGoogle();
    const now = Date.UTC(2026, 10, 2, 15, 0, 0);
    await listTabs({ config, fetch: google.fetch, now: () => now });

    const tokenCall = google.calls.find((c) => c.url === TOKEN_URL);
    assert.ok(tokenCall);
    assert.equal(tokenCall.method, "POST");
    assert.equal(tokenCall.headers.get("content-type"), "application/x-www-form-urlencoded");
    const form = new URLSearchParams(tokenCall.body ?? "");
    assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
    const assertion = form.get("assertion") ?? "";

    assert.deepEqual(decodeProtectedHeader(assertion), { alg: "RS256", typ: "JWT" });
    const { payload } = await jwtVerify(assertion, await importSPKI(publicPem, "RS256"), {
      issuer: EMAIL,
      audience: TOKEN_URL,
      currentDate: new Date(now),
    });
    assert.equal(payload.scope, "https://www.googleapis.com/auth/spreadsheets");
    assert.equal(payload.iat, now / 1000);
    assert.equal(payload.exp, now / 1000 + 3600);

    // The tab list then goes out with the token.
    const listCall = google.calls.find((c) => c.url.startsWith("https://sheets.googleapis.com/"));
    assert.equal(listCall?.headers.get("authorization"), `Bearer ${ACCESS_TOKEN}`);
    assert.ok(listCall?.url.startsWith(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=`));
    assert.equal(
      new URL(listCall!.url).searchParams.get("fields"),
      "sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),developerMetadata)",
    );
  });

  it("reuses the token until a minute before it runs out", async () => {
    const google = fakeGoogle();
    let now = Date.UTC(2026, 10, 2, 15, 0, 0);
    const options = { config, fetch: google.fetch, now: () => now };
    await listTabs(options);
    await listTabs(options);
    assert.equal(google.calls.filter((c) => c.url === TOKEN_URL).length, 1);

    now += 3600_000 - 61_000;
    await listTabs(options);
    assert.equal(google.calls.filter((c) => c.url === TOKEN_URL).length, 1);

    now += 2_000; // now inside the last minute
    await listTabs(options);
    assert.equal(google.calls.filter((c) => c.url === TOKEN_URL).length, 2);
  });

  it("signs in with a key pasted with quotes and literal \\n", async () => {
    const pasted = readSheetsConfig({
      GOOGLE_SERVICE_ACCOUNT_EMAIL: EMAIL,
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: `"${pem.replace(/\n/g, "\\n")}"`,
      GOOGLE_LEDGER_TEST_SPREADSHEET_ID: SPREADSHEET_ID,
    });
    assert.ok(pasted);
    const google = fakeGoogle({ tabs: [tab(1, "Sheet1")] });
    const tabs = await listTabs({ config: pasted, fetch: google.fetch });
    assert.equal(tabs[0].title, "Sheet1");
  });

  it("reports an unreadable key without echoing it", async () => {
    const broken = { ...config, privateKey: "-----BEGIN " + "PRIVATE KEY-----\nnot-really-a-key\n-----END PRIVATE KEY-----" };
    const google = fakeGoogle();
    await assert.rejects(listTabs({ config: broken, fetch: google.fetch }), (error: unknown) => {
      assert.ok(error instanceof SheetsError);
      assert.doesNotMatch(error.message, /not-really-a-key/);
      return true;
    });
    assert.equal(google.calls.length, 0);
  });
});

describe("writing the portal's tab", () => {
  it("writes only to the tab carrying the portal's marker, in one batchUpdate", async () => {
    const google = fakeGoogle({ tabs: [tab(0, "2026-2027"), tab(55, "Conron (October 2026)"), tab(77, PORTAL_TAB_TITLE, true)] });
    const result = await writePortalLedgerTab(GRID, { config, fetch: google.fetch });
    assert.deepEqual(result, { spreadsheetId: SPREADSHEET_ID, sheetTabId: 77, created: false });

    const batches = batchCalls(google.calls);
    assert.equal(batches.length, 1);
    const body = JSON.parse(batches[0].body ?? "{}");
    assert.deepEqual(new Set(sheetIdsIn(body)), new Set([77]));
    assert.deepEqual(body.requests[0], {
      updateSheetProperties: {
        properties: { sheetId: 77, gridProperties: { rowCount: 200, columnCount: PORTAL_TAB_COLUMNS, frozenRowCount: 2 } },
        fields: "gridProperties(rowCount,columnCount,frozenRowCount)",
      },
    });
    assert.deepEqual(body.requests[1].updateCells.range, {
      sheetId: 77,
      startRowIndex: 0,
      startColumnIndex: 0,
      endColumnIndex: PORTAL_TAB_COLUMNS,
    });
    assert.equal(body.requests[1].updateCells.fields, "userEnteredValue,userEnteredFormat(numberFormat,textFormat,wrapStrategy)");
    assert.deepEqual(body.requests[1].updateCells.rows, GRID.rows);
    assert.equal(body.requests.length, 2);
    // A "=" description went as text.
    assert.doesNotMatch(batches[0].body ?? "", /formulaValue/);
  });

  it("refuses a hand-made tab with the portal's name, sending no write", async () => {
    for (const title of [PORTAL_TAB_TITLE, "portal ledger"]) {
      const google = fakeGoogle({ tabs: [tab(0, "2026-2027"), tab(12, title)] });
      await assert.rejects(writePortalLedgerTab(GRID, { config, fetch: google.fetch }), (error: unknown) => {
        assert.ok(error instanceof SheetsError);
        assert.equal(error.message, UNTAGGED_TAB_MESSAGE);
        return true;
      });
      assert.equal(batchCalls(google.calls).length, 0);
      assert.ok(google.calls.every((c) => c.method === "GET" || c.url === TOKEN_URL));
    }
  });

  it("ignores a marker that belongs to another tab", async () => {
    const google = fakeGoogle({ tabs: [tab(12, PORTAL_TAB_TITLE, true, 999)] });
    await assert.rejects(writePortalLedgerTab(GRID, { config, fetch: google.fetch }), /wasn't made by the portal/);
    assert.equal(batchCalls(google.calls).length, 0);
  });

  it("creates and marks the tab in the same request when there isn't one", async () => {
    const google = fakeGoogle({ tabs: [tab(0, "2026-2027"), tab(3, "2025-2026")] });
    const result = await writePortalLedgerTab(GRID, { config, fetch: google.fetch });
    assert.equal(result.created, true);
    assert.ok(![0, 3].includes(result.sheetTabId));

    const batches = batchCalls(google.calls);
    assert.equal(batches.length, 1);
    const { requests } = JSON.parse(batches[0].body ?? "{}");
    assert.deepEqual(requests[0], {
      addSheet: {
        properties: {
          sheetId: result.sheetTabId,
          title: PORTAL_TAB_TITLE,
          gridProperties: { rowCount: 200, columnCount: PORTAL_TAB_COLUMNS, frozenRowCount: 2 },
        },
      },
    });
    assert.deepEqual(requests[1], {
      createDeveloperMetadata: {
        developerMetadata: {
          metadataKey: PORTAL_TAB_METADATA_KEY,
          metadataValue: "1",
          location: { sheetId: result.sheetTabId },
          visibility: "DOCUMENT",
        },
      },
    });
    assert.equal(requests[2].updateCells.range.sheetId, result.sheetTabId);
    assert.deepEqual(new Set(sheetIdsIn(requests)), new Set([result.sheetTabId]));
  });

  it("follows the stored tab when it was renamed, but never a stored tab that lost its marker", async () => {
    const renamed = fakeGoogle({ tabs: [tab(0, "2026-2027"), tab(77, "Ledger copy", true)] });
    const result = await writePortalLedgerTab(GRID, {
      config,
      fetch: renamed.fetch,
      stored: { spreadsheetId: SPREADSHEET_ID, sheetTabId: 77 },
    });
    assert.equal(result.sheetTabId, 77);

    const unmarked = fakeGoogle({ tabs: [tab(77, PORTAL_TAB_TITLE)] });
    await assert.rejects(
      writePortalLedgerTab(GRID, { config, fetch: unmarked.fetch, stored: { spreadsheetId: SPREADSHEET_ID, sheetTabId: 77 } }),
      /no longer has the portal's marker/,
    );
    assert.equal(batchCalls(unmarked.calls).length, 0);
  });

  it("never writes to a scouting-year tab, even one carrying the marker", () => {
    const tabs = [{ sheetId: 4, title: "2026-2027", rowCount: 1, columnCount: 1, developerMetadata: [] }].map((t) => ({
      ...t,
      developerMetadata: [{ metadataKey: PORTAL_TAB_METADATA_KEY, metadataValue: "1", locationSheetId: 4 }],
    }));
    assert.equal(choosePortalTab(tabs, { spreadsheetId: SPREADSHEET_ID, sheetTabId: 4 }, SPREADSHEET_ID).action, "refuse");
  });

  it("ignores a stored tab from a different spreadsheet", () => {
    const tabs = [{ sheetId: 77, title: "Someone's tab", rowCount: 1, columnCount: 1, developerMetadata: [] }];
    assert.deepEqual(choosePortalTab(tabs, { spreadsheetId: "OTHER_spreadsheet_00000", sheetTabId: 77 }, SPREADSHEET_ID), {
      action: "create",
    });
  });

  it("refuses a grid with a formula or too many columns before calling Google", async () => {
    const google = fakeGoogle({ tabs: [tab(77, PORTAL_TAB_TITLE, true)] });
    const formula = { rows: [{ values: [{ userEnteredValue: { formulaValue: "=IMPORTDATA(1)" } }] }], frozenRowCount: 0 } as unknown as SheetGrid;
    await assert.rejects(writePortalLedgerTab(formula, { config, fetch: google.fetch }), /only text, number/);
    const wide: SheetGrid = { rows: [{ values: Array.from({ length: 9 }, () => ({})) }], frozenRowCount: 0 };
    await assert.rejects(writePortalLedgerTab(wide, { config, fetch: google.fetch }), /too many columns/);
    assert.equal(google.calls.length, 0);
  });
});

describe("reading a tab for the import", () => {
  it("reads unformatted values with serial dates, quoting the title", async () => {
    const google = fakeGoogle({ tabs: [tab(0, "Bob's 2026-2027")], values: [["", "Date"], [46023, "Dues", 12.5, true]] });
    const values = await readTabValues("Bob's 2026-2027", { config, fetch: google.fetch });
    assert.deepEqual(values, [["", "Date"], [46023, "Dues", 12.5, true]]);

    const valuesCall = google.calls.find((c) => c.url.includes("/values/"));
    assert.ok(valuesCall);
    const url = new URL(valuesCall.url);
    assert.ok(valuesCall.url.includes(`/values/${encodeURIComponent("'Bob''s 2026-2027'!A1:J1000")}?`));
    assert.equal(url.searchParams.get("valueRenderOption"), "UNFORMATTED_VALUE");
    assert.equal(url.searchParams.get("dateTimeRenderOption"), "SERIAL_NUMBER");
  });

  it("refuses a title that isn't one of the tabs, before building any range", async () => {
    const google = fakeGoogle({ tabs: [tab(0, "2026-2027")] });
    await assert.rejects(readTabValues("2026-2027'!A1:Z/../x", { config, fetch: google.fetch }), /isn't in the Sheet/);
    assert.ok(!google.calls.some((c) => c.url.includes("/values/")));
  });
});

describe("errors", () => {
  async function failure(options: Parameters<typeof fakeGoogle>[0]) {
    const google = fakeGoogle({ tabs: [tab(77, PORTAL_TAB_TITLE, true)], ...options });
    const logged: string[] = [];
    const spy = mock.method(console, "error", (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
    try {
      await writePortalLedgerTab(GRID, { config, fetch: google.fetch });
      assert.fail("expected the write to fail");
    } catch (error) {
      assert.ok(error instanceof SheetsError, String(error));
      const tokenBody = google.calls.find((c) => c.url === TOKEN_URL)?.body ?? "";
      const assertion = new URLSearchParams(tokenBody).get("assertion") ?? "";
      const keyBody = pem.split("\n")[1];
      for (const text of [error.message, ...logged]) {
        assert.ok(!text.includes(BODY_SECRET), "Google's reply leaked");
        assert.ok(!text.includes(ACCESS_TOKEN), "the access token leaked");
        assert.ok(!assertion || !text.includes(assertion.slice(-40)), "the signed JWT leaked");
        assert.ok(!text.includes(keyBody), "the key leaked");
      }
      return { error, logged, calls: google.calls };
    } finally {
      spy.mock.restore();
    }
  }

  const googleError = (code: number, status: string) => ({
    status: code,
    body: { error: { code, message: `${BODY_SECRET} ${status}`, status, details: [BODY_SECRET] } },
  });

  it("maps a 403 to sharing the Sheet with the service account", async () => {
    const { error } = await failure({ list: googleError(403, "PERMISSION_DENIED") });
    assert.equal(error.message, `Share the Sheet with ${EMAIL} as Editor`);
  });

  it("maps a 403 for a switched-off Sheets API to turning it on, logging only the reason word", async () => {
    const body = {
      error: {
        code: 403,
        message: `${BODY_SECRET} Google Sheets API has not been used in project 123 before or it is disabled.`,
        status: "PERMISSION_DENIED",
        details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED", metadata: { x: BODY_SECRET } }],
      },
    };
    const { error } = await failure({ list: { status: 403, body } });
    assert.equal(error.message, "Turn on the Google Sheets API for the service account's project");
  });

  it("maps a 404 to a missing spreadsheet", async () => {
    const { error } = await failure({ list: googleError(404, "NOT_FOUND") });
    assert.equal(error.message, "Spreadsheet not found");
  });

  it("maps a 429 to retry later", async () => {
    const { error } = await failure({ batch: googleError(429, "RESOURCE_EXHAUSTED") });
    assert.equal(error.message, "Google is busy; will retry");
    assert.equal(error.retryLater, true);
  });

  it("maps anything else to the status alone, logging only the status", async () => {
    const { error, logged } = await failure({ batch: googleError(400, "INVALID_ARGUMENT") });
    assert.equal(error.message, "Google error 400");
    assert.ok(logged.some((line) => line.includes("400") && line.includes("INVALID_ARGUMENT")));
  });

  it("maps a refused sign-in (invalid_grant) to the key or clock", async () => {
    const { error, calls } = await failure({
      token: { status: 400, body: { error: "invalid_grant", error_description: `${BODY_SECRET} Invalid JWT` } },
    });
    assert.equal(error.message, "Service account key or server clock is wrong");
    assert.equal(calls.length, 1);
  });

  it("maps a timeout to retry later", async () => {
    const { error } = await failure({ throws: new DOMException("The operation timed out.", "TimeoutError") });
    assert.equal(error.message, "Google didn't answer in time; will retry");
    assert.equal(error.retryLater, true);
  });
});
