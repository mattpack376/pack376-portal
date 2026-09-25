import "server-only";
import { redirect } from "next/navigation";
import { getSessionState, type SessionPayload } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isMasterAdminUsername, isProtectedUsername } from "@/lib/masterAdmins";

/*
 * Permission levels, most to least access:
 *
 * - Master Admin (ADMIN + a username in masterAdmins.ts): everything.
 * - Admin: everything except the audit log, Start a Fresh Year, and making
 *   anyone an Admin (creating one or promoting to one).
 * - Junior Admin: advancement and attendance for every den; can add scouts
 *   to a den but not rename or remove them; reads dues and event balances
 *   without recording payments; posts the top banner (no homepage events);
 *   sends photo consent links; reads the Camp Conron page.
 * - Committee Member: advancement and attendance for every den; reads photo
 *   consent and dues. No event money, no parent contacts.
 * - Den Leader: advancement and attendance for their assigned den(s), plus
 *   that den's parent contacts, Family View and photo consent. No money.
 *
 * A Committee Member assigned to a den also gets that den's Den Leader view,
 * so a leader who sits on the committee keeps one login. Any staff account
 * linked to a scout additionally sees that child at /portal/my-family.
 *
 * Attendance Only, Photographer and Trip Viewer are narrower roles outside
 * this ladder; see their own guards below.
 */

type Session = SessionPayload;

/** Where a role lands after login / when bounced from a route it can't access. */
export function homeForRole(role: SessionPayload["role"]) {
  if (role === "ADMIN") return "/portal/admin";
  if (role === "JUNIOR_ADMIN") return "/portal/admin";
  if (role === "COMMITTEE") return "/portal/admin";
  if (role === "ATTENDANCE_ADMIN") return "/portal/admin/attendance";
  if (role === "PHOTOGRAPHER") return "/portal/admin/albums";
  if (role === "PARENT") return "/portal/parent";
  if (role === "TRIP_VIEWER") return "/portal/admin/camp-conron";
  return "/portal/den";
}

/**
 * Den Leaders and Committee Members get a den's leader view through their
 * den assignments. For Admin and Junior Admin an assignment only lists them
 * as that den's leader — they reach every den regardless.
 */
export function isDenScopedRole(role: SessionPayload["role"]) {
  return role === "DEN" || role === "COMMITTEE";
}

function leadsDen(session: Session, denId: string) {
  return isDenScopedRole(session.role) && session.denIds.includes(denId);
}

/** For Server Components / pages: redirects if there's no valid session. */
export async function requireSession(): Promise<SessionPayload> {
  const { session, revoked } = await getSessionState();
  // A revoked token still has a valid signature, so redirecting straight to
  // /portal/login would let the edge proxy bounce it back to /portal (loop).
  // Route it through /portal/logout, which clears the cookie first.
  if (revoked) redirect("/portal/logout");
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
 * For Server Components / pages: every role that edits advancement for every
 * den — Admin, Junior Admin and Committee Member. Den structure changes
 * (create/promote) stay admin-only via nested layouts.
 */
export async function requireAdvancementSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== "ADMIN" && session.role !== "JUNIOR_ADMIN" && session.role !== "COMMITTEE") {
    redirect(homeForRole(session.role));
  }
  return session;
}

/**
 * For Server Components / pages: every role that can touch pack-wide
 * attendance — Admin, Junior Admin, Committee Member and Attendance Only.
 * Blocks den leaders (den-scoped only) and Photographer (no attendance access).
 */
export async function requireAttendanceSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (
    session.role !== "ADMIN" &&
    session.role !== "JUNIOR_ADMIN" &&
    session.role !== "COMMITTEE" &&
    session.role !== "ATTENDANCE_ADMIN"
  ) {
    redirect(homeForRole(session.role));
  }
  return session;
}

/**
 * For Server Components / pages: every role that can touch photo albums —
 * Admin and Photographer.
 */
export async function requireAlbumSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== "ADMIN" && session.role !== "PHOTOGRAPHER") {
    redirect(homeForRole(session.role));
  }
  return session;
}

/**
 * Who reaches parent contact info and Family View. Admin and Junior Admin see
 * every den; a Den Leader, or a Committee Member assigned to a den, sees only
 * their assigned den(s) — the caller scopes by session.denIds.
 */
export function canViewParentContacts(session: Session) {
  if (session.role === "ADMIN" || session.role === "JUNIOR_ADMIN" || session.role === "DEN") return true;
  return session.role === "COMMITTEE" && session.denIds.length > 0;
}

/** For Server Components / pages: parent contacts and Family View — see canViewParentContacts. */
export async function requireParentContactsSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (!canViewParentContacts(session)) redirect(homeForRole(session.role));
  return session;
}

/**
 * For Server Components / pages: photo consent status. Admin, Junior Admin,
 * Committee Member and Photographer read every den; a Den Leader reads only
 * their own. Who can generate, copy and email the links is a separate,
 * narrower question — canManagePhotoConsentForDen below.
 */
export async function requirePhotoConsentSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (
    session.role !== "ADMIN" &&
    session.role !== "JUNIOR_ADMIN" &&
    session.role !== "COMMITTEE" &&
    session.role !== "DEN" &&
    session.role !== "PHOTOGRAPHER"
  ) {
    redirect(homeForRole(session.role));
  }
  return session;
}

/**
 * Generating, copying and emailing a den's photo consent links: Admin and
 * Junior Admin for any den, a Den Leader or den-assigned Committee Member for
 * their own. The link is what lets a parent sign, so read-only roles don't
 * see it at all.
 */
export function canManagePhotoConsentForDen(session: Session, denId: string) {
  if (session.role === "ADMIN" || session.role === "JUNIOR_ADMIN") return true;
  return leadsDen(session, denId);
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

/** Admin, Junior Admin, Committee Member or Attendance Only — pack-wide attendance actions. */
export function assertAttendanceAccess(session: SessionPayload) {
  if (
    session.role !== "ADMIN" &&
    session.role !== "JUNIOR_ADMIN" &&
    session.role !== "COMMITTEE" &&
    session.role !== "ATTENDANCE_ADMIN"
  ) {
    throw new Error("Not authorized: attendance access required.");
  }
}

/** Full admin or Photographer — album create/edit/hide actions. Delete stays admin-only. */
export function assertAlbumEditAccess(session: SessionPayload) {
  if (session.role !== "ADMIN" && session.role !== "PHOTOGRAPHER") {
    throw new Error("Not authorized: album edit access required.");
  }
}

/** Admin or Junior Admin for any den's parent contacts; a den-scoped login only for its assigned den(s). */
export function assertParentContactsDenAccess(session: SessionPayload, denId: string) {
  if (session.role === "ADMIN" || session.role === "JUNIOR_ADMIN") return;
  if (leadsDen(session, denId)) return;
  throw new Error("Not authorized for this den.");
}

/** Generate/regenerate/email a photo consent link — see canManagePhotoConsentForDen. */
export function assertPhotoConsentDenAccess(session: SessionPayload, denId: string) {
  if (canManagePhotoConsentForDen(session, denId)) return;
  throw new Error("Not authorized for this den.");
}

/** Admin, Junior Admin, Committee Member or Attendance Only for any den; a den login only for its assigned den(s). */
export function assertAttendanceDenAccess(session: SessionPayload, denId: string) {
  if (
    session.role === "ADMIN" ||
    session.role === "JUNIOR_ADMIN" ||
    session.role === "COMMITTEE" ||
    session.role === "ATTENDANCE_ADMIN"
  ) {
    return;
  }
  if (session.role === "DEN" && session.denIds.includes(denId)) return;
  throw new Error("Not authorized for this den.");
}

/**
 * Clearing a whole den's marks for one meeting — the roles with pack-wide
 * attendance editing, minus Attendance Only (which never had it).
 */
export function canResetDenAttendance(session: Session) {
  return session.role === "ADMIN" || session.role === "JUNIOR_ADMIN" || session.role === "COMMITTEE";
}

/** Admin, Junior Admin or Committee Member for any den's advancement; a den login only for its assigned den(s). */
export function assertAdvancementDenAccess(session: SessionPayload, denId: string) {
  if (session.role === "ADMIN" || session.role === "JUNIOR_ADMIN" || session.role === "COMMITTEE") return;
  if (session.role === "DEN" && session.denIds.includes(denId)) return;
  throw new Error("Not authorized for this den.");
}

/**
 * Adding a scout to a den's roster — Admin and Junior Admin. Renaming or
 * removing a scout, creating a den and promoting one stay admin-only.
 */
export function canAddScoutsToDens(session: Session) {
  return session.role === "ADMIN" || session.role === "JUNIOR_ADMIN";
}

export function assertCanAddScoutsToDens(session: Session) {
  if (!canAddScoutsToDens(session)) {
    throw new Error("Not authorized: adding scouts requires Admin or Junior Admin.");
  }
}

/**
 * For Server Components / pages: the Homepage Content page. Admin manages
 * everything on it; Junior Admin sees only the top banner (the page itself
 * hides the homepage events section for them).
 */
export async function requireHomepageContentSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== "ADMIN" && session.role !== "JUNIOR_ADMIN") redirect(homeForRole(session.role));
  return session;
}

/**
 * Posting, editing and switching off the top banner — Admin and Junior Admin,
 * so a junior admin can put up an urgent notice (a cancelled meeting) and take
 * it down again. Deleting a banner, and everything about homepage events,
 * stays admin-only via assertAdmin.
 */
export function assertSiteBannerAccess(session: SessionPayload) {
  if (session.role !== "ADMIN" && session.role !== "JUNIOR_ADMIN") {
    throw new Error("Not authorized: top banner access required.");
  }
}

/**
 * For Server Components / pages: gates the whole /portal/admin/camp-conron
 * page — Admin (editable), Junior Admin and TRIP_VIEWER (both read-only; the
 * page renders a separate form-free view for them). Every edit action on the
 * page is admin-only via assertAdmin. The public conron.pack376nyc.org page
 * needs no session at all.
 */
export async function requireTripPageSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== "ADMIN" && session.role !== "JUNIOR_ADMIN" && session.role !== "TRIP_VIEWER") {
    redirect(homeForRole(session.role));
  }
  return session;
}

/**
 * Who sees what families owe. Admin records and deletes payments; Junior
 * Admin reads dues and event balances; Committee Member reads dues only. Den
 * Leaders see no money at all, beyond their own linked child at
 * /portal/my-family.
 */
export function canViewDues(session: Session) {
  return session.role === "ADMIN" || session.role === "JUNIOR_ADMIN" || session.role === "COMMITTEE";
}

export function canViewEventMoney(session: Session) {
  return session.role === "ADMIN" || session.role === "JUNIOR_ADMIN";
}

/** For Server Components / pages: the Dues pages — see canViewDues. Only Admin gets the edit forms. */
export async function requireDuesViewSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (!canViewDues(session)) redirect(homeForRole(session.role));
  return session;
}

/** For Server Components / pages: the Events pages — see canViewEventMoney. Only Admin gets the edit forms. */
export async function requireEventsViewSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (!canViewEventMoney(session)) redirect(homeForRole(session.role));
  return session;
}

/**
 * For Server Components / pages: the pack-wide roster (every den, leader, and
 * scout name) — every staff role, but never a PARENT account. The parent nav
 * never links here, but that alone doesn't stop a direct visit.
 */
export async function requireRosterSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role === "PARENT") redirect(homeForRole(session.role));
  return session;
}

/** For Server Components / pages: only PARENT-role accounts reach the Parent Dashboard. */
export async function requireParentSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== "PARENT") redirect(homeForRole(session.role));
  return session;
}

/**
 * Whether this session is a master admin (src/lib/masterAdmins.ts). Needs a
 * username lookup, so pages that only branch on it (rather than gating on it)
 * call this instead of requireMasterAdminSession.
 */
export async function isMasterAdminSession(session: SessionPayload) {
  if (session.role !== "ADMIN") return false;
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { username: true } });
  return !!user && isMasterAdminUsername(user.username);
}

/**
 * For Server Components / pages: only master admin accounts
 * (src/lib/masterAdmins.ts) can reach the page; every other role, including
 * regular and junior admins, gets bounced.
 */
export async function requireMasterAdminSession(): Promise<SessionPayload> {
  const session = await requireAdminSession();
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { username: true } });
  if (!user || !isMasterAdminUsername(user.username)) redirect("/portal/admin");
  return session;
}

/** For Server Actions: throws unless the acting user is a master admin. */
export async function assertMasterAdmin(session: SessionPayload) {
  if (session.role !== "ADMIN") throw new Error("Not authorized: master admin only.");
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { username: true } });
  if (!user || !isMasterAdminUsername(user.username)) {
    throw new Error("Not authorized: master admin only.");
  }
}

/**
 * The single guard every mutation that reaches a User row must pass — not
 * just the ones in the Users panel. A protected account
 * (PROTECTED_USERNAMES in src/lib/masterAdmins.ts) can only be changed by a
 * master admin, or by itself — so a protected Admin can still update their
 * own name, email and phone, but no other Admin can reset their password or
 * edit them. Role changes and deletion have stricter rules on top of this in
 * src/lib/actions/users.ts.
 *
 * This exists because the check used to be copied inline into each action in
 * src/lib/actions/users.ts, so any *other* path to a User row — the parent
 * contact editor and the Parent Portal revoke button in actions/parents.ts,
 * both of which write through a linked Parent row — simply didn't have it.
 * Route every such write through here instead of re-deriving the rule.
 */
export async function assertCanMutateUser(session: SessionPayload, target: { id: string; username: string }) {
  if (!isProtectedUsername(target.username)) return;
  if (target.id === session.userId) return;
  await assertMasterAdmin(session);
}

/**
 * Making someone an Admin — creating an ADMIN account, or changing an
 * existing account's role to ADMIN — is master-admin only. Leaving an
 * existing Admin as Admin isn't a grant.
 */
export async function assertCanGrantRole(session: SessionPayload, role: string, currentRole?: string) {
  if (role !== "ADMIN" || currentRole === "ADMIN") return;
  await assertMasterAdmin(session);
}

/**
 * Master status and protection are decided by username
 * (src/lib/masterAdmins.ts), so a protected username that ever becomes free
 * is a way back in: recreate it and that account inherits master privileges
 * or undeletability. Account creation reserves every protected name so the
 * name alone can never be claimed, whatever happened to the original row.
 */
export function isReservedUsername(username: string) {
  return isProtectedUsername(username);
}
