import "server-only";
import { createHash, randomInt } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import { readSheetsConfig, type SheetsConfig } from "@/lib/googleSheetsConfig";

export { isSheetsConfigured } from "@/lib/googleSheetsConfig";

/*
 * A small Google Sheets client for the Ledger's copy of itself: no Google
 * library, just a service-account sign-in (a JWT signed with jose) and the
 * Sheets v4 REST API through fetch.
 *
 * The portal only ever writes ONE tab, "Portal Ledger", and only when that tab
 * carries the portal's developer-metadata marker (added in the same request
 * that creates the tab). A hand-made tab with that name is refused, and no
 * request ever names another tab's sheetId — the treasurer's own tabs are
 * only ever read (by the one-time import).
 *
 * Errors are SheetsError with a short message a treasurer can act on. Google's
 * replies, the key, the signed JWT and the access token never go into an
 * error or a log line: only the HTTP status and Google's one-word status.
 */

/** The portal's tab. Hardcoded on purpose: never configurable, so it can't be pointed at a real tab. */
export const PORTAL_TAB_TITLE = "Portal Ledger";
/** The developer-metadata key that marks a tab as the portal's. */
export const PORTAL_TAB_METADATA_KEY = "pack376-portal-ledger";
/** Columns the portal's tab is trimmed to (the layout uses 7). */
export const PORTAL_TAB_COLUMNS = 8;
/** One overall time limit for everything a sync asks of Google. */
export const SHEETS_DEADLINE_MS = 40_000;

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets/";
const JWT_BEARER = "urn:ietf:params:oauth:grant-type:jwt-bearer";
/** Use a cached token only while it has more than this left. */
const TOKEN_MARGIN_MS = 60_000;
const MIN_TAB_ROWS = 200;
const SPARE_TAB_ROWS = 20;
/** What the import may read of a tab. */
const IMPORT_RANGE = "A1:J1000";
/** A scouting-year tab like "2026-2027" is the treasurer's, whatever metadata it carries. */
const YEAR_TAB = /^\s*\d{4}\s*-\s*\d{4}\s*$/;
const TAB_FIELDS = "sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),developerMetadata)";
/** What updateCells sets (and clears, in the rest of the tab). */
const CELL_FIELDS = "userEnteredValue,userEnteredFormat(numberFormat,textFormat,wrapStrategy)";

export const UNTAGGED_TAB_MESSAGE = `A tab named ${PORTAL_TAB_TITLE} already exists and wasn't made by the portal. Rename or delete it.`;

// ---------- Types (the parts of the Sheets API the portal uses) ----------

/** A typed cell value. Never a formula: text is stored as text, so nothing typed in the portal can run in the Sheet. */
export type SheetCellValue = { stringValue: string } | { numberValue: number } | { boolValue: boolean };

export type SheetNumberFormat = { type: "DATE" | "CURRENCY" | "NUMBER" | "TEXT"; pattern?: string };

export type SheetCell = {
  userEnteredValue?: SheetCellValue;
  userEnteredFormat?: {
    numberFormat?: SheetNumberFormat;
    textFormat?: { bold?: boolean; italic?: boolean };
    wrapStrategy?: "WRAP" | "OVERFLOW_CELL" | "CLIP";
  };
};

/** One row of cells (the API's RowData). */
export type SheetRow = { values: SheetCell[] };

/** What the portal writes: every row from the top, and how many rows stay frozen while scrolling. */
export type SheetGrid = { rows: SheetRow[]; frozenRowCount: number };

export type SheetTab = {
  sheetId: number;
  title: string;
  rowCount: number;
  columnCount: number;
  developerMetadata: { metadataKey: string; metadataValue: string | null; locationSheetId: number | null }[];
};

/** A cell as the import reads it: unformatted, dates as serial numbers. */
export type SheetValue = string | number | boolean;

/** Where the portal's tab was last written, as saved in LedgerSettings. */
export type StoredPortalTab = { spreadsheetId: string | null; sheetTabId: number | null };

export type SheetsCallOptions = {
  /** For tests: a stand-in for fetch. */
  fetch?: typeof fetch;
  /** One deadline for the whole job; defaults to SHEETS_DEADLINE_MS from the call. */
  signal?: AbortSignal;
  /** For tests: settings instead of the environment. */
  config?: SheetsConfig | null;
  /** For tests: the clock, in milliseconds. */
  now?: () => number;
};

/** A failure with a short, safe message (shown to the treasurer and saved as lastSyncError). */
export class SheetsError extends Error {
  constructor(
    message: string,
    /** The HTTP status Google answered with, if it answered. */
    readonly status: number | null = null,
    /** Worth trying again later (Google busy, slow or unreachable). */
    readonly retryLater = false,
  ) {
    super(message);
    this.name = "SheetsError";
  }
}

type Context = { config: SheetsConfig; fetch: typeof fetch; signal: AbortSignal; now: () => number };

function context(options: SheetsCallOptions): Context {
  const config = options.config === undefined ? readSheetsConfig() : options.config;
  if (!config) throw new SheetsError("Google Sheet sync isn't set up.");
  return {
    config,
    fetch: options.fetch ?? globalThis.fetch,
    signal: options.signal ?? AbortSignal.timeout(SHEETS_DEADLINE_MS),
    now: options.now ?? Date.now,
  };
}

// ---------- Requests and errors ----------

/** Google's one-word status (e.g. PERMISSION_DENIED, invalid_grant) — the only part of a reply ever logged. */
function googleStatus(body: unknown): string | null {
  const error = (body as { error?: unknown } | null)?.error;
  const raw = typeof error === "string" ? error : (error as { status?: unknown } | undefined)?.status;
  return typeof raw === "string" && /^[A-Za-z_]{1,40}$/.test(raw) ? raw : null;
}

/** The reason word from Google's error details (e.g. SERVICE_DISABLED), if it gave one. */
function googleReason(body: unknown): string | null {
  const details = ((body as { error?: unknown } | null)?.error as { details?: unknown } | undefined)?.details;
  if (!Array.isArray(details)) return null;
  for (const detail of details) {
    const reason = (detail as { reason?: unknown } | null)?.reason;
    if (typeof reason === "string" && /^[A-Z_]{1,40}$/.test(reason)) return reason;
  }
  return null;
}

function mapError(kind: "token" | "sheets", status: number, body: unknown, config: SheetsConfig): SheetsError {
  const code = googleStatus(body);
  const reason = googleReason(body);
  console.error(
    `[ledger-sync] Google ${kind} request failed: HTTP ${status}${code ? ` ${code}` : ""}${reason ? ` ${reason}` : ""}`,
  );
  if (status === 429) return new SheetsError("Google is busy; will retry", status, true);
  if (kind === "token") {
    if (status === 400 && code === "invalid_grant") return new SheetsError("Service account key or server clock is wrong", status);
    return new SheetsError(`Google sign-in failed (${status})`, status, status >= 500);
  }
  if (status === 401) cachedToken = null;
  // A 403 is also what Google sends when the Sheets API is off for the
  // service account's Cloud project — common on first setup.
  if (status === 403 && reason === "SERVICE_DISABLED") {
    return new SheetsError("Turn on the Google Sheets API for the service account's project", status);
  }
  if (status === 403 && reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT") {
    return new SheetsError("The service account's sign-in is missing Sheets access", status);
  }
  if (status === 403) return new SheetsError(`Share the Sheet with ${config.email} as Editor`, status);
  if (status === 404) return new SheetsError("Spreadsheet not found", status);
  return new SheetsError(`Google error ${status}`, status, status >= 500);
}

async function call(ctx: Context, kind: "token" | "sheets", url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await ctx.fetch(url, { ...init, signal: ctx.signal, cache: "no-store" });
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name;
    console.error(`[ledger-sync] Google ${kind} request didn't complete: ${typeof name === "string" ? name : "error"}`);
    if (name === "AbortError" || name === "TimeoutError") throw new SheetsError("Google didn't answer in time; will retry", null, true);
    throw new SheetsError("Couldn't reach Google; will retry", null, true);
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) throw mapError(kind, response.status, body, ctx.config);
  return body;
}

// ---------- Signing in ----------

let cachedToken: { key: string; token: string; expiresAt: number } | null = null;

/** For tests: forget the cached access token. */
export function clearSheetsTokenCache() {
  cachedToken = null;
}

/** A service-account access token, reused until a minute before it runs out. */
async function accessToken(ctx: Context): Promise<string> {
  const { email, privateKey } = ctx.config;
  // Keyed on the account and key, so a rotated key never reuses the old token.
  const cacheKey = createHash("sha256").update(`${email}\n${privateKey}`).digest("hex");
  const now = ctx.now();
  if (cachedToken && cachedToken.key === cacheKey && cachedToken.expiresAt - TOKEN_MARGIN_MS > now) return cachedToken.token;

  let key: CryptoKey;
  try {
    key = await importPKCS8(privateKey, "RS256");
  } catch {
    throw new SheetsError("The service account key can't be read. Paste its private_key again.");
  }
  const issuedAt = Math.floor(now / 1000);
  const assertion = await new SignJWT({ scope: SHEETS_SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(email)
    .setAudience(TOKEN_URL)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 3600)
    .sign(key);

  const body = (await call(ctx, "token", TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: JWT_BEARER, assertion }).toString(),
  })) as { access_token?: unknown; expires_in?: unknown } | null;

  const token = body?.access_token;
  if (typeof token !== "string" || !token) throw new SheetsError("Google sign-in failed");
  const expiresIn = typeof body?.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 3600;
  cachedToken = { key: cacheKey, token, expiresAt: now + expiresIn * 1000 };
  return token;
}

async function sheetsCall(ctx: Context, path: string, init: RequestInit = {}): Promise<unknown> {
  const token = await accessToken(ctx);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return call(ctx, "sheets", `${SHEETS_BASE}${encodeURIComponent(ctx.config.spreadsheetId)}${path}`, { ...init, headers });
}

// ---------- Tabs ----------

function toInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function parseTabs(body: unknown): SheetTab[] {
  const sheets = (body as { sheets?: unknown } | null)?.sheets;
  if (!Array.isArray(sheets)) return [];
  return sheets.flatMap((sheet): SheetTab[] => {
    const properties = (sheet as { properties?: Record<string, unknown> })?.properties;
    if (!properties || typeof properties.sheetId !== "number" || typeof properties.title !== "string") return [];
    const grid = (properties.gridProperties ?? {}) as Record<string, unknown>;
    const metadata = (sheet as { developerMetadata?: unknown }).developerMetadata;
    return [
      {
        sheetId: properties.sheetId,
        title: properties.title,
        rowCount: toInt(grid.rowCount, 0),
        columnCount: toInt(grid.columnCount, 0),
        developerMetadata: (Array.isArray(metadata) ? metadata : []).flatMap((entry) => {
          const md = entry as { metadataKey?: unknown; metadataValue?: unknown; location?: { sheetId?: unknown } };
          if (typeof md?.metadataKey !== "string") return [];
          return [
            {
              metadataKey: md.metadataKey,
              metadataValue: typeof md.metadataValue === "string" ? md.metadataValue : null,
              locationSheetId: typeof md.location?.sheetId === "number" ? md.location.sheetId : null,
            },
          ];
        }),
      },
    ];
  });
}

async function listTabsWith(ctx: Context): Promise<SheetTab[]> {
  return parseTabs(await sheetsCall(ctx, `?fields=${encodeURIComponent(TAB_FIELDS)}`));
}

/** Every tab in the spreadsheet, with its size and developer metadata. */
export async function listTabs(options: SheetsCallOptions = {}): Promise<SheetTab[]> {
  return listTabsWith(context(options));
}

/** Whether a tab carries the portal's marker (on that tab, not some other one). */
export function isPortalTab(tab: SheetTab): boolean {
  return tab.developerMetadata.some(
    (md) => md.metadataKey === PORTAL_TAB_METADATA_KEY && (md.locationSheetId === null || md.locationSheetId === tab.sheetId),
  );
}

export type PortalTabChoice = { action: "write"; tab: SheetTab } | { action: "create" } | { action: "refuse"; message: string };

/**
 * Which tab a sync may write, from the spreadsheet's tab list:
 * - the tab saved last time (same spreadsheet), if it still has the marker;
 * - otherwise a tab titled "Portal Ledger" — only with the marker;
 * - no such tab: make one.
 * Anything else is refused, so a hand-made tab is never overwritten.
 */
export function choosePortalTab(tabs: readonly SheetTab[], stored: StoredPortalTab | null, spreadsheetId: string): PortalTabChoice {
  const usable = (tab: SheetTab) => isPortalTab(tab) && !YEAR_TAB.test(tab.title);
  const storedId = stored && stored.spreadsheetId === spreadsheetId ? stored.sheetTabId : null;
  if (storedId !== null) {
    const tab = tabs.find((t) => t.sheetId === storedId);
    if (tab) {
      return usable(tab)
        ? { action: "write", tab }
        : { action: "refuse", message: `The portal's tab "${tab.title}" no longer has the portal's marker. Rename or delete it.` };
    }
  }
  // Sheets treats tab names that differ only in case as the same name.
  const named = tabs.filter((t) => t.title.trim().toLowerCase() === PORTAL_TAB_TITLE.toLowerCase());
  if (named.length === 0) return { action: "create" };
  const tagged = named.find(usable);
  return tagged ? { action: "write", tab: tagged } : { action: "refuse", message: UNTAGGED_TAB_MESSAGE };
}

// ---------- Reading (the one-time import) ----------

/**
 * A tab's cells for the import, A1:J1000: unformatted values with dates as
 * serial numbers. The title must be one of the spreadsheet's tabs right now —
 * it's checked against a fresh tab list before it goes into the URL.
 */
export async function readTabValues(title: string, options: SheetsCallOptions = {}): Promise<SheetValue[][]> {
  const ctx = context(options);
  const tab = (await listTabsWith(ctx)).find((t) => t.title === title);
  if (!tab) throw new SheetsError("That tab isn't in the Sheet. Pick it again.");
  const range = `'${tab.title.replace(/'/g, "''")}'!${IMPORT_RANGE}`;
  const body = (await sheetsCall(
    ctx,
    `/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
  )) as { values?: unknown } | null;
  const values = Array.isArray(body?.values) ? body.values : [];
  return values.map((row) =>
    (Array.isArray(row) ? row : []).map((cell): SheetValue =>
      typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean" ? cell : cell == null ? "" : String(cell),
    ),
  );
}

// ---------- Writing the portal's tab ----------

/** Refuses a grid that could do more than write typed values into the portal's columns. */
function checkGrid(grid: SheetGrid) {
  if (!Number.isInteger(grid.frozenRowCount) || grid.frozenRowCount < 0 || grid.frozenRowCount > grid.rows.length) {
    throw new Error("Ledger sheet grid: bad frozen row count.");
  }
  for (const row of grid.rows) {
    if (row.values.length > PORTAL_TAB_COLUMNS) throw new Error("Ledger sheet grid: too many columns.");
    for (const cell of row.values) {
      const value = cell.userEnteredValue;
      if (!value) continue;
      const keys = Object.keys(value);
      const ok =
        keys.length === 1 &&
        (("stringValue" in value && typeof value.stringValue === "string") ||
          ("numberValue" in value && Number.isFinite(value.numberValue)) ||
          ("boolValue" in value && typeof value.boolValue === "boolean"));
      if (!ok) throw new Error("Ledger sheet grid: only text, number and true/false cells are written.");
    }
  }
}

function newSheetId(tabs: readonly SheetTab[]): number {
  const taken = new Set(tabs.map((t) => t.sheetId));
  for (;;) {
    const id = randomInt(1_000_000, 2_147_483_647);
    if (!taken.has(id)) return id;
  }
}

/**
 * Writes the grid to the portal's tab — creating and marking the tab first
 * if there isn't one — in ONE batchUpdate, so the tab is never seen half
 * written. updateCells covers the whole tab from A1, so anything below the
 * new rows is cleared. Returns where it wrote, for LedgerSettings.
 */
export async function writePortalLedgerTab(
  grid: SheetGrid,
  options: SheetsCallOptions & { stored?: StoredPortalTab | null } = {},
): Promise<{ spreadsheetId: string; sheetTabId: number; created: boolean }> {
  checkGrid(grid);
  const ctx = context(options);
  const tabs = await listTabsWith(ctx);
  const choice = choosePortalTab(tabs, options.stored ?? null, ctx.config.spreadsheetId);
  if (choice.action === "refuse") throw new SheetsError(choice.message);

  const gridProperties = {
    rowCount: Math.max(MIN_TAB_ROWS, grid.rows.length + SPARE_TAB_ROWS),
    columnCount: PORTAL_TAB_COLUMNS,
    frozenRowCount: grid.frozenRowCount,
  };
  const sheetId = choice.action === "create" ? newSheetId(tabs) : choice.tab.sheetId;
  const requests: unknown[] =
    choice.action === "create"
      ? [
          { addSheet: { properties: { sheetId, title: PORTAL_TAB_TITLE, gridProperties } } },
          {
            createDeveloperMetadata: {
              developerMetadata: {
                metadataKey: PORTAL_TAB_METADATA_KEY,
                metadataValue: "1",
                location: { sheetId },
                visibility: "DOCUMENT",
              },
            },
          },
        ]
      : [
          {
            updateSheetProperties: {
              properties: { sheetId, gridProperties },
              fields: "gridProperties(rowCount,columnCount,frozenRowCount)",
            },
          },
        ];
  requests.push({
    updateCells: {
      range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: PORTAL_TAB_COLUMNS },
      rows: grid.rows,
      fields: CELL_FIELDS,
    },
  });

  await sheetsCall(ctx, ":batchUpdate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
  });
  return { spreadsheetId: ctx.config.spreadsheetId, sheetTabId: sheetId, created: choice.action === "create" };
}
