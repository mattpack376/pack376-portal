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
export const SESSION_DURATION_SECONDS = 45 * 24 * 60 * 60; // 45 days

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

export async function signSession(payload: SessionPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(secretKey());
}

/** The token's payload if its signature and expiry check out. Says nothing about revocation — see getSessionState in auth.ts. */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
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
