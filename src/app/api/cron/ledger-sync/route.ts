import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runLedgerSync } from "@/lib/ledgerSync";

// Google gets up to 40 s of this (SHEETS_DEADLINE_MS).
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Shorter secrets are refused outright, so a weak one can't be guessed. */
const MIN_SECRET_LENGTH = 32;
const NO_STORE = { "Cache-Control": "no-store" };

function sha256(value: string) {
  return createHash("sha256").update(value).digest();
}

/**
 * Vercel's cron sends "Authorization: Bearer <CRON_SECRET>". Both sides are
 * hashed first so the comparison is fixed-length and constant-time.
 */
function isCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < MIN_SECRET_LENGTH) return false;
  const header = request.headers.get("authorization") ?? "";
  return timingSafeEqual(sha256(header), sha256(`Bearer ${secret}`));
}

/**
 * The daily refresh of the Ledger's Google Sheet copy (vercel.json "crons"),
 * so the Sheet catches up even if a sync after a change failed. Sends back
 * only the outcome — never ledger data.
 */
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const result = await runLedgerSync({ reason: "cron" });
  return NextResponse.json({ status: result.status }, { headers: NO_STORE });
}
