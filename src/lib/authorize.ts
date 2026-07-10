import "server-only";
import { redirect } from "next/navigation";
import { getSession, type SessionPayload } from "@/lib/auth";

/** Where a role lands after login / when bounced from a route it can't access. */
export function homeForRole(role: SessionPayload["role"]) {
  if (role === "ADMIN") return "/portal/admin";
  if (role === "JUNIOR_ADMIN") return "/portal/admin";
  if (role === "ATTENDANCE_ADMIN") return "/portal/admin/attendance";
  if (role === "PHOTOGRAPHER") return "/portal/admin/albums";
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
 * For Server Components / pages: allows full admins and junior admins, since
 * both can browse every den and edit advancement pack-wide. Den structure
 * changes (create/promote/roster) stay admin-only via nested layouts.
 */
export async function requireAdvancementSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== "ADMIN" && session.role !== "JUNIOR_ADMIN") redirect(homeForRole(session.role));
  return session;
}

/**
 * For Server Components / pages: allows every role that can touch
 * pack-wide attendance — full admin, junior admin, and Attendance Only.
 * Blocks den leaders (den-scoped only) and Photographer (no attendance access).
 */
export async function requireAttendanceSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== "ADMIN" && session.role !== "JUNIOR_ADMIN" && session.role !== "ATTENDANCE_ADMIN") {
    redirect(homeForRole(session.role));
  }
  return session;
}

/**
 * For Server Components / pages: allows every role that can touch photo
 * albums — full admin, junior admin, and Photographer. Attendance Only and
 * den leaders don't get album access.
 */
export async function requireAlbumSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== "ADMIN" && session.role !== "JUNIOR_ADMIN" && session.role !== "PHOTOGRAPHER") {
    redirect(homeForRole(session.role));
  }
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

/** Full admin, junior admin, or Attendance Only — pack-wide attendance actions. */
export function assertAttendanceAccess(session: SessionPayload) {
  if (session.role !== "ADMIN" && session.role !== "JUNIOR_ADMIN" && session.role !== "ATTENDANCE_ADMIN") {
    throw new Error("Not authorized: attendance access required.");
  }
}

/** Full admin, junior admin, or Photographer — album create/edit/hide actions. Delete stays admin-only. */
export function assertAlbumEditAccess(session: SessionPayload) {
  if (session.role !== "ADMIN" && session.role !== "JUNIOR_ADMIN" && session.role !== "PHOTOGRAPHER") {
    throw new Error("Not authorized: album edit access required.");
  }
}

/** Full admin, junior admin, or Attendance Only for any den; a den login only for its own den. */
export function assertAttendanceDenAccess(session: SessionPayload, denId: string) {
  if (session.role === "ADMIN" || session.role === "JUNIOR_ADMIN" || session.role === "ATTENDANCE_ADMIN") return;
  if (session.role === "DEN" && session.denId === denId) return;
  throw new Error("Not authorized for this den.");
}

/** Full admin or junior admin for any den's advancement; a den login only for its own den. */
export function assertAdvancementDenAccess(session: SessionPayload, denId: string) {
  if (session.role === "ADMIN" || session.role === "JUNIOR_ADMIN") return;
  if (session.role === "DEN" && session.denId === denId) return;
  throw new Error("Not authorized for this den.");
}
