import "server-only";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  SESSION_COOKIE,
  SESSION_DURATION_SECONDS,
  signSession,
  verifySessionToken,
  type SessionPayload,
} from "@/lib/session";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSessionCookie(payload: SessionPayload) {
  const token = await signSession(payload);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // Host-only: omitting `domain` scopes the session to the exact host that
    // served the login (portal.pack376nyc.org) instead of every subdomain of
    // pack376nyc.org. A vulnerable or abandoned sibling subdomain then can't
    // receive the portal session cookie.
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  // Must match the path the cookie was set with (createSessionCookie above).
  // The cookie is host-only (no domain), so it's deleted host-only too —
  // passing a domain here would target a different cookie and leave the real
  // session cookie in place.
  cookieStore.delete({
    name: SESSION_COOKIE,
    path: "/",
  });
}

/**
 * Full session state, distinguishing "no valid token" from "valid token whose
 * account has since been revoked" (password reset, role/den change, or account
 * deletion — anything that bumps User.sessionVersion). Callers that redirect
 * need this distinction: a revoked user must be sent somewhere that clears the
 * cookie, or the still-valid signature would keep passing the edge proxy and
 * loop. `revoked` is only true when a well-formed token failed the DB check.
 */
export async function getSessionState(): Promise<{ session: SessionPayload | null; revoked: boolean }> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return { session: null, revoked: false };

  const payload = await verifySessionToken(token);
  if (!payload) return { session: null, revoked: false };

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { sessionVersion: true },
  });
  // User deleted, or the token's version is stale relative to the account.
  if (!user || user.sessionVersion !== payload.sv) {
    return { session: null, revoked: true };
  }

  return { session: payload, revoked: false };
}

export async function getSession(): Promise<SessionPayload | null> {
  return (await getSessionState()).session;
}

export function isLockedOut(lockedUntil: Date | null) {
  return !!lockedUntil && lockedUntil.getTime() > Date.now();
}

/**
 * Given a failure count that's already been incremented (atomically, against
 * the database's current value — see loginAction), decides whether it now
 * crosses the lockout threshold. Kept as a pure function so the caller owns
 * the read-modify-write against the DB; this just answers "does this count
 * lock the account."
 */
export function lockedUntilForCount(newFailedCount: number): Date | null {
  return newFailedCount >= LOCKOUT_THRESHOLD ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null;
}
