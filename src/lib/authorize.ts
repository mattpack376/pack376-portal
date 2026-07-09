import "server-only";
import { redirect } from "next/navigation";
import { getSession, type SessionPayload } from "@/lib/auth";

/** For Server Components / pages: redirects if there's no valid session. */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/portal/login");
  return session;
}

/** For Server Components / pages: redirects non-admins away from admin-only routes. */
export async function requireAdminSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== "ADMIN") redirect("/portal/den");
  return session;
}

/**
 * For Server Actions (mutations): throws instead of redirecting, since a
 * legitimate user should never hit this via the normal UI — this only fires
 * on a tampered request. Never trust a client-submitted denId; always check
 * against the session.
 */
export function assertAdmin(session: SessionPayload) {
  if (session.role !== "ADMIN") {
    throw new Error("Not authorized: admin only.");
  }
}

export function assertDenAccess(session: SessionPayload, denId: string) {
  if (session.role === "ADMIN") return;
  if (session.role === "DEN" && session.denId === denId) return;
  throw new Error("Not authorized for this den.");
}
