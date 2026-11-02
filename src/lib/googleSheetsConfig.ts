import "server-only";

/*
 * Which Google spreadsheet the Ledger copies itself to, and the service
 * account it signs in as — all from environment variables, never the repo
 * (it's public). Kept apart from googleSheets.ts so asking "is the Sheet set
 * up?" doesn't load the signing library.
 *
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL        the key file's client_email
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY  the key file's private_key
 *   GOOGLE_LEDGER_SPREADSHEET_ID        the pack's Sheet (production only)
 *   GOOGLE_LEDGER_TEST_SPREADSHEET_ID   a throwaway Sheet (everywhere else)
 *
 * Outside production (previews, local dev) only the TEST spreadsheet is ever
 * used, so a copied .env.local can't overwrite the real Sheet with test data.
 */

export type SheetsConfig = {
  email: string;
  privateKey: string;
  spreadsheetId: string;
  /** True when this is the production deployment (the real Sheet). */
  production: boolean;
};

const EMAIL = /^[^\s@]{1,100}@[^\s@]{1,200}$/;
/** Google spreadsheet IDs are letters, digits, - and _; anything else never reaches a URL. */
const SPREADSHEET_ID = /^[A-Za-z0-9_-]{10,200}$/;

/**
 * The private key as pasted into Vercel, made usable: trimmed, one pair of
 * surrounding quotes removed (copied from the JSON file), and literal "\n"
 * turned into real line breaks.
 */
export function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  if (key.length >= 2 && (key[0] === '"' || key[0] === "'") && key.at(-1) === key[0]) key = key.slice(1, -1);
  return key.replace(/\\n/g, "\n").trim();
}

/** The Sheet settings, or null when any is missing or malformed (sync then does nothing). Never throws. */
export function readSheetsConfig(env: Record<string, string | undefined> = process.env): SheetsConfig | null {
  try {
    const email = (env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "").trim();
    const privateKey = normalizePrivateKey(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "");
    const production = env.VERCEL_ENV === "production";
    // Outside production the real ID is ignored entirely.
    const spreadsheetId = ((production ? env.GOOGLE_LEDGER_SPREADSHEET_ID : env.GOOGLE_LEDGER_TEST_SPREADSHEET_ID) ?? "").trim();
    if (!EMAIL.test(email) || !privateKey.includes("PRIVATE KEY-----") || !SPREADSHEET_ID.test(spreadsheetId)) return null;
    return { email, privateKey, spreadsheetId, production };
  } catch {
    return null;
  }
}

/** Whether the Google Sheet copy can run here at all. Never throws. */
export function isSheetsConfigured(env?: Record<string, string | undefined>): boolean {
  return readSheetsConfig(env) !== null;
}
