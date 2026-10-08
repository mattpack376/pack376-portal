import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@/generated/prisma/enums";

/*
 * The parts of a portal session that src/proxy.ts needs as well as the app:
 * the cookie name, the signed token, and where each role lands. Kept free of
 * "server-only", next/headers and Prisma so the proxy can import it —
 * src/lib/auth.ts adds the cookie store and the database revocation check on
 * top.
 */

export const SESSION_COOKIE = "pack376_session";
// Signed out after this long with no portal activity. Every authenticated
// portal request (page load, navigation, Server Action) counts as activity:
// src/proxy.ts swaps in a freshly-issued token once the current one is older
// than SESSION_RENEW_AFTER_SECONDS, and a token is rejected once its iat is
// older than this.
export const SESSION_IDLE_TIMEOUT_SECONDS = 2 * 24 * 60 * 60; // 2 days
// Hard cap from the original sign-in, however active the session stays — the
// renewals above carry the sign-in time forward in `auth_time` and never
// extend past it.
export const SESSION_MAX_LIFETIME_SECONDS = 45 * 24 * 60 * 60; // 45 days
// How stale a token gets before the proxy renews it, so it isn't re-signed on
// every single request. Last activity is known to within this much.
const SESSION_RENEW_AFTER_SECONDS = 10 * 60; // 10 minutes

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export type SessionPayload = {
  userId: string;
  role: Role;
  denIds: string[];
  // The scout(s) this account is linked to via Parent.userId — a PARENT
  // login's whole family, or a staff member's own child (/portal/my-family).
  // Present for every role (rather than optional) so callers can read it
  // unconditionally, same as denIds.
  scoutIds: string[];
  displayName: string;
  // Snapshot of User.sessionVersion at sign-in. Compared against the DB on
  // every protected request so password/role/den changes revoke old tokens.
  sv: number;
};

/** A verified token's payload plus the two timestamps (epoch seconds) renewal needs. */
export type VerifiedSession = SessionPayload & { iat: number; auth_time: number };

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Signs a session token good for the idle timeout, or less if that would run
 * past the hard cap. `authTime` is the original sign-in — omitted at sign-in
 * itself, passed through unchanged on every renewal.
 */
export async function signSession(payload: SessionPayload, authTime = nowSeconds()) {
  const now = nowSeconds();
  const exp = Math.min(now + SESSION_IDLE_TIMEOUT_SECONDS, authTime + SESSION_MAX_LIFETIME_SECONDS);
  const token = await new SignJWT({ ...payload, auth_time: authTime })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(secretKey());
  return { token, maxAge: exp - now };
}

/**
 * The token's payload if its signature, expiry, idle timeout and hard cap all
 * check out. Says nothing about revocation — see getSessionState in auth.ts.
 *
 * The idle and cap checks are explicit rather than left to `exp` so they also
 * hold for tokens issued before the idle timeout existed (45-day `exp`, no
 * `auth_time`): one of those whose sign-in is more than two days old is
 * rejected, and the user signs in again once.
 */
export async function verifySessionToken(token: string): Promise<VerifiedSession | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ["HS256"],
      maxTokenAge: SESSION_IDLE_TIMEOUT_SECONDS,
    });
    const iat = payload.iat as number;
    const authTime = typeof payload.auth_time === "number" ? payload.auth_time : iat;
    if (nowSeconds() - authTime > SESSION_MAX_LIFETIME_SECONDS) return null;
    return { ...(payload as unknown as SessionPayload), iat, auth_time: authTime };
  } catch {
    return null;
  }
}

/**
 * A replacement token for an active session, or null while the current one is
 * still recent enough to keep. Carries the claims forward untouched — role,
 * dens, sv and so on are a sign-in snapshot, and a revoked session's sv stays
 * stale, so renewing never revives anything getSessionState would refuse.
 */
export async function renewSessionToken(session: VerifiedSession) {
  if (nowSeconds() - session.iat < SESSION_RENEW_AFTER_SECONDS) return null;
  const { userId, role, denIds, scoutIds, displayName, sv } = session;
  return signSession({ userId, role, denIds, scoutIds, displayName, sv }, session.auth_time);
}

/**
 * Cookie options shared by sign-in (auth.ts) and renewal (proxy.ts). Host-only:
 * omitting `domain` scopes the session to the exact host that served the login
 * (portal.pack376nyc.org) instead of every subdomain of pack376nyc.org. A
 * vulnerable or abandoned sibling subdomain then can't receive the portal
 * session cookie. `maxAge` tracks the token's own expiry, so an idle browser
 * drops the cookie when the token stops being accepted.
 */
export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

/** Where a role lands after login / when bounced from a route it can't access. */
export function homeForRole(role: Role) {
  if (role === "ADMIN") return "/portal/admin";
  if (role === "JUNIOR_ADMIN") return "/portal/admin";
  if (role === "COMMITTEE") return "/portal/admin";
  if (role === "ATTENDANCE_ADMIN") return "/portal/admin/attendance";
  if (role === "PHOTOGRAPHER") return "/portal/admin/albums";
  if (role === "PARENT") return "/portal/parent";
  if (role === "TRIP_VIEWER") return "/portal/admin/camp-conron";
  return "/portal/den";
}
