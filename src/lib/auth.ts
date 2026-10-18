import "server-only";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { isAllDensTestUsername } from "@/lib/denTestAccounts";
import { RANK_ORDER } from "@/lib/rankConfig";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
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
  const { token, maxAge } = await signSession(payload);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions(maxAge));
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
    select: { sessionVersion: true, username: true, active: true },
  });
  // User deleted, switched inactive, or the token's version is stale relative
  // to the account. (Going inactive also bumps sessionVersion; checking the
  // flag too keeps it from depending on that.)
  if (!user || !user.active || user.sessionVersion !== payload.sv) {
    return { session: null, revoked: true };
  }

  // A den test login (src/lib/denTestAccounts.ts) leads every den. Worked out
  // here on each request instead of stored as den assignments, which are what
  // list an account as a den's leader — and so a den created or removed later
  // is picked up straight away rather than at the next sign-in.
  if (payload.role === "DEN" && isAllDensTestUsername(user.username)) {
    return { session: { ...payload, denIds: await allDenIds() }, revoked: false };
  }

  return { session: payload, revoked: false };
}

/** Every den, newest scouting year first and youngest rank first — the order the den tabs show them in. */
async function allDenIds() {
  const dens = await prisma.den.findMany({ select: { id: true, rank: true, scoutingYear: true, label: true } });
  dens.sort((a, b) => {
    if (a.scoutingYear !== b.scoutingYear) return b.scoutingYear.localeCompare(a.scoutingYear);
    if (a.rank !== b.rank) return RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank);
    return a.label.localeCompare(b.label);
  });
  return dens.map((den) => den.id);
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
