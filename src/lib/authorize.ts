import "server-only";
import { redirect } from "next/navigation";
import { getSession, type SessionPayload } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isMasterAdminUsername } from "@/lib/masterAdmins";

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
 * albums — full admin and Photographer. Junior Admin, Attendance Only, and
 * den leaders don't get album access.
 */
export async function requireAlbumSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== "ADMIN" && session.role !== "PHOTOGRAPHER") {
    redirect(homeForRole(session.role));
  }
  return session;
}

/**
 * For Server Components / pages: parent contact info — full admin and junior
 * admin see every den, a den leader sees only their own assigned den(s)
 * (enforced by the caller via session.denIds). Attendance Only and
 * Photographer don't need this contact info.
 */
export async function requireParentContactsSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== "ADMIN" && session.role !== "JUNIOR_ADMIN" && session.role !== "DEN") {
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

/** Full admin or Photographer — album create/edit/hide actions. Delete stays admin-only. */
export function assertAlbumEditAccess(session: SessionPayload) {
  if (session.role !== "ADMIN" && session.role !== "PHOTOGRAPHER") {
    throw new Error("Not authorized: album edit access required.");
  }
}

/** Full admin or junior admin for any den's parent contacts; a den login only for its assigned den(s). */
export function assertParentContactsDenAccess(session: SessionPayload, denId: string) {
  if (session.role === "ADMIN" || session.role === "JUNIOR_ADMIN") return;
  if (session.role === "DEN" && session.denIds.includes(denId)) return;
  throw new Error("Not authorized for this den.");
}

/** Full admin, junior admin, or Attendance Only for any den; a den login only for its assigned den(s). */
export function assertAttendanceDenAccess(session: SessionPayload, denId: string) {
  if (session.role === "ADMIN" || session.role === "JUNIOR_ADMIN" || session.role === "ATTENDANCE_ADMIN") return;
  if (session.role === "DEN" && session.denIds.includes(denId)) return;
  throw new Error("Not authorized for this den.");
}

/** Full admin or junior admin for any den's advancement; a den login only for its assigned den(s). */
export function assertAdvancementDenAccess(session: SessionPayload, denId: string) {
  if (session.role === "ADMIN" || session.role === "JUNIOR_ADMIN") return;
  if (session.role === "DEN" && session.denIds.includes(denId)) return;
  throw new Error("Not authorized for this den.");
}

/**
 * For Server Components / pages: only the three protected master admin
 * accounts (src/lib/masterAdmins.ts) can reach the page; every other role,
 * including regular and junior admins, gets bounced.
 */
export async function requireMasterAdminSession(): Promise<SessionPayload> {
  const session = await requireAdminSession();
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { username: true } });
  if (!user || !isMasterAdminUsername(user.username)) redirect("/portal/admin");
  return session;
}

/** For Server Actions: throws unless the acting user is one of the three protected master admins. */
export async function assertMasterAdmin(session: SessionPayload) {
  if (session.role !== "ADMIN") throw new Error("Not authorized: master admin only.");
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { username: true } });
  if (!user || !isMasterAdminUsername(user.username)) {
    throw new Error("Not authorized: master admin only.");
  }
}
