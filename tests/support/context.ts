/*
 * Test-side view of the shared state set up in hooks.mjs, plus helpers to run
 * code "inside a request": runAs() signs a real session token for a user (the
 * same signSession the app uses) and serves it through the next/headers
 * stand-in, so getSession() runs its real checks, sessionVersion included.
 */
import type { AsyncLocalStorage } from "node:async_hooks";
import { SESSION_COOKIE, signSession, type SessionPayload } from "@/lib/session";

export type RequestStore = { cookies: Map<string, string>; headers: Headers };

export type SentEmail = {
  from?: string;
  to: string | string[];
  bcc?: string | string[];
  replyTo?: string | string[];
  subject: string;
  html?: string;
  text?: string;
  attachments?: { filename: string; content: Buffer | string }[];
  headers?: Record<string, string>;
  /** The second argument to send(), e.g. { idempotencyKey }. */
  sendOptions?: Record<string, unknown>;
};

/** One scripted outcome for the next fake Resend call (see mocks/resend.mjs). */
export type ResendBehavior =
  | { error: { name: string; message: string } }
  | { throws: string }
  | { pause: () => Promise<void> };

type TestState = {
  als: AsyncLocalStorage<RequestStore>;
  emails: SentEmail[];
  blobPuts: { pathname: string; url: string; options?: { contentType?: string }; size: number | null }[];
  blobDeletes: string[];
  revalidated: string[];
  rateLimited: boolean;
  /** Set to "not-found" to fake a missing Firewall rule (see mocks/firewall.mjs). */
  rateLimitError: "not-found" | null;
  /** Every rate-limit check made, in order. */
  rateLimitCalls: { rateLimitId: string; rateLimitKey?: string }[];
  failBlobPut: boolean;
  failBlobDel: boolean;
  /** Host used in fake Blob URLs (see mocks/blob.mjs). */
  blobHost: string;
  resendQueue: ResendBehavior[];
  /** Named pause points tests can install; see pausePoint(). */
  pauses: Record<string, (() => Promise<void>) | undefined>;
};

const state = (globalThis as unknown as { __pack376Test?: TestState }).__pack376Test;
if (!state) throw new Error("tests/support/hooks.mjs was not loaded (run tests through npm test / npm run test:db)");
export const testState: TestState = state;

export type SessionUser = {
  id: string;
  role: SessionPayload["role"];
  sessionVersion: number;
  displayName?: string | null;
  denIds?: string[];
  scoutIds?: string[];
};

function requestHeaders(extra?: Record<string, string>) {
  // x-real-ip is what Vercel sets and what the rate limiter counts by.
  return new Headers({ "x-forwarded-for": "127.0.0.1", "x-real-ip": "127.0.0.1", "user-agent": "pack376-tests", ...extra });
}

/** Runs fn as a signed-in user (real signed token, real getSession checks). */
export async function runAs<T>(user: SessionUser, fn: () => Promise<T>, headers?: Record<string, string>): Promise<T> {
  const { token } = await signSession({
    userId: user.id,
    role: user.role,
    denIds: user.denIds ?? [],
    scoutIds: user.scoutIds ?? [],
    displayName: user.displayName ?? "Test user",
    sv: user.sessionVersion,
  });
  const store: RequestStore = { cookies: new Map([[SESSION_COOKIE, token]]), headers: requestHeaders(headers) };
  return testState.als.run(store, fn);
}

/** Runs fn as an anonymous visitor; returns the cookies the code set too. */
export async function asAnonymous<T>(
  fn: () => Promise<T>,
  headers?: Record<string, string>,
): Promise<{ result: T; cookies: Map<string, string> }> {
  const store: RequestStore = { cookies: new Map(), headers: requestHeaders(headers) };
  const result = await testState.als.run(store, fn);
  return { result, cookies: store.cookies };
}

/** Builds FormData from plain values (all stringified, like a browser form). */
export function form(values: Record<string, string | number | boolean | null | undefined | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => data.append(key, v));
    else data.set(key, String(value));
  }
  return data;
}

/** Settles a promise into ok/error so a test can assert on refusals. */
export async function settle<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: Error }> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

/** A gate a test can open later: `await gate.wait` resolves once `gate.open()` runs. */
export function gate() {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

export function resetTestState() {
  testState.emails.length = 0;
  testState.blobPuts.length = 0;
  testState.blobDeletes.length = 0;
  testState.revalidated.length = 0;
  testState.rateLimited = false;
  testState.rateLimitError = null;
  testState.rateLimitCalls.length = 0;
  testState.failBlobPut = false;
  testState.failBlobDel = false;
  testState.blobHost = "test.public.blob.vercel-storage.com";
  testState.resendQueue.length = 0;
  testState.pauses = {};
}
