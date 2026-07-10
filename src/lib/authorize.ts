import "server-only";
import { redirect } from "next/navigation";
import { getSession, type SessionPayload } from "@/lib/auth";

/** Where a role lands after login / when bounced from a route it can't access. */
export function homeForRole(role: SessionPayload["role"]) {
  if (role === "ADMIN") return "/portal/admin";
  if (role === "ATTENDANCE_ADMIN") return "/portal/admin/attendance";
  return "/portal/den";
}

/** For Server Components / pages: redirects if there's no valid session. */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/portal/login");
  return session;
}

/** For Server Components / pages: redirects non-admins away from admin-only routes. */
export async function requireAdminSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== "ADMIN") redirect(homeForRole(session.role));
  return session;
}

/**
 * For Server Components / pages: allows full admins and attendance-only
 * admins, since both can see attendance pack-wide. Blocks den leaders.
 */
export async function requireAttendanceSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== "ADMIN" && session.role !== "ATTENDANCE_ADMIN") redirect(homeForRole(session.role));
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

/** Like assertAdmin, but also allows the attendance-only admin role. */
export function assertAttendanceAccess(session: SessionPayload) {
  if (session.role !== "ADMIN" && session.role !== "ATTENDANCE_ADMIN") {
    throw new Error("Not authorized: admin or attendance access required.");
  }
}

export function assertDenAccess(session: SessionPayload, denId: string) {
  if (session.role === "ADMIN") return;
  if (session.role === "DEN" && session.denId === denId) return;
  throw new Error("Not authorized for this den.");
}

/** Like assertDenAccess, but also allows the attendance-only admin role for any den. */
export function assertAttendanceDenAccess(session: SessionPayload, denId: string) {
  if (session.role === "ADMIN" || session.role === "ATTENDANCE_ADMIN") return;
  if (session.role === "DEN" && session.denId === denId) return;
  throw new Error("Not authorized for this den.");
}
