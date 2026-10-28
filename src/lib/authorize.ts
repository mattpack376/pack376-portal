import "server-only";
import { redirect } from "next/navigation";
import { getSessionState } from "@/lib/auth";
import { homeForRole, type SessionPayload } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { isMasterAdminUsername, isProtectedUsername } from "@/lib/masterAdmins";

/*
 * Permission levels, most to least access:
 *
 * - Master Admin (ADMIN + a username in masterAdmins.ts): everything.
 * - Admin: everything except the audit log, Start a Fresh Year, and creating
 *   or deleting Admin accounts (which includes promoting someone to Admin).
 *   Admins can edit each other's accounts.
 * - Junior Admin: advancement and attendance for every den; can add scouts
 *   to a den but not rename or remove them; reads dues and event balances
 *   without recording payments; posts the top banner (no homepage events);
 *   sends photo consent links; reads the 50/50 raffles. No Camp Conron
 *   trip page (removed 2026-10-14).
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
 *
 * A Den Leader test login (src/lib/denTestAccounts.ts) is treated as leading
 * every den without being assigned to — or listed under — any of them;
 * getSessionState in auth.ts fills its dens in, so every check below that
 * reads session.denIds covers it with no special case.
 *
 * One permission is per person rather than per level: Raffle Helper, which an
 * Admin switches on for a specific staff login below Admin. Never a parent
 * account: parents see nothing about the 50/50. See raffleAccessFor below.
 *
 * The Committee & Leaders contact list is the one thing every staff level can
 * see — read-only for everyone but an Admin, who edits it (requireAdminSession
 * on the Manage page). Admin and Junior Admin can also export it (CSV, PDF,
 * Printable View) and email/copy its addresses. Parent and Trip Viewer logins
 * never see it.
 *
 * The calendar (Content -> Calendar) works the same way: every staff level,
 * Junior Admin included, reads it, and only an Admin adds, edits, hides or
 * deletes anything on it.
 */

type Session = SessionPayload;

// Re-exported so pages that guard with requireSession() can redirect from one import.
export { homeForRole };

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

/**
 * Leader & committee attendance — Admin (master admins included), Junior
 * Admin and Attendance Only. Narrower than scout attendance on purpose:
 * Committee Members are on that list themselves, so they don't take it.
 */
export function canAccessLeaderAttendance(session: Session) {
  return session.role === "ADMIN" || session.role === "JUNIOR_ADMIN" || session.role === "ATTENDANCE_ADMIN";
}

/** For Server Components / pages: the leader & committee tracker — see canAccessLeaderAttendance. */
export async function requireLeaderAttendanceSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (!canAccessLeaderAttendance(session)) redirect(homeForRole(session.role));
  return session;
}

/** For Server Actions and the CSV export — see canAccessLeaderAttendance. */
export function assertLeaderAttendanceAccess(session: Session) {
  if (!canAccessLeaderAttendance(session)) {
    throw new Error("Not authorized: leader attendance access required.");
  }
}

/** Clearing every leader & committee mark for one meeting — the leader roles minus Attendance Only, as on the scout side. */
export function canResetLeaderAttendance(session: Session) {
  return session.role === "ADMIN" || session.role === "JUNIOR_ADMIN";
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
 * Who may open the Calendar page in the portal to read it: every staff level
 * (Admin, Junior Admin, Committee Member, Den Leader, Attendance Only,
 * Photographer), view-only. The shared Trip Viewer login and parent accounts
 * don't see it. Mirrors the /portal/admin/calendar rule in src/proxy.ts.
 */
export const CALENDAR_VIEW_ROLES: SessionPayload["role"][] = [
  "ADMIN",
  "JUNIOR_ADMIN",
  "COMMITTEE",
  "DEN",
  "ATTENDANCE_ADMIN",
  "PHOTOGRAPHER",
];

/** For Server Components / pages: the calendar list — see CALENDAR_VIEW_ROLES. Only an Admin gets the controls. */
export async function requireCalendarViewSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (!CALENDAR_VIEW_ROLES.includes(session.role)) redirect(homeForRole(session.role));
  return session;
}

/**
 * Adding, editing, hiding and deleting calendar events, and changing the
 * regular Friday meeting — Admin only. Junior Admin and everyone below read the
 * calendar but can't change it. The pages that hold the forms use
 * requireAdminSession; every Server Action goes through here.
 */
export function assertCalendarEditAccess(session: SessionPayload) {
  if (session.role !== "ADMIN") {
    throw new Error("Not authorized: only an Admin can change the calendar.");
  }
}

/**
 * For Server Components / pages: gates each event's admin page
 * (/portal/admin/camp-conron, /portal/admin/cyclones — TRIP_SITES) — Admin (editable) and TRIP_VIEWER (read-only; the page renders a
 * separate form-free view for it). Junior Admin had the same read-only view
 * until 2026-10-14 and is now turned away; the rule in proxy.ts and the nav
 * link in PortalNav.tsx went with it. Every edit action on the page is
 * admin-only via assertAdmin. The public event pages (conron.pack376nyc.org, …)
 * need no session at all.
 */
export async function requireTripPageSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== "ADMIN" && session.role !== "TRIP_VIEWER") {
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
 * What a login may do on the 50/50 raffle pages:
 *
 *  - "admin": everything — start, import, close and reopen raffles, verify
 *    and correct payments, record the winner, download the records.
 *  - "helper": the Raffle Helper permission (User.raffleHelper), which an
 *    Admin gives to particular people from the raffles page so they can work
 *    a raffle without being Admins. A helper sees everything, sells boxes,
 *    edits a buyer, takes away a box picked by mistake, records a buyer's
 *    payment, and can void a payment they recorded themselves until an Admin
 *    verifies it. A helper can't start, change, close or delete a raffle,
 *    can't verify or correct a payment or void anyone else's, can't record
 *    the winner, and can't download the records.
 *  - "viewer": a Junior Admin without the permission — reads, changes nothing.
 *
 * Everyone else has no access at all. The permission is read from the
 * database on every request rather than carried in the session, so giving or
 * taking it away takes effect on the person's next click.
 */
export type RaffleAccess = "admin" | "helper" | "viewer";

/**
 * The levels that can hold the Raffle Helper permission: every individual
 * staff login below Admin. Not Admin (already has everything), not Trip
 * Viewer (a shared login rather than a person), and never PARENT — parents
 * must not see the 50/50 or any money the pack has collected. Mirrors the
 * /portal/admin/raffles rule in src/proxy.ts.
 */
export const RAFFLE_HELPER_ROLES: SessionPayload["role"][] = [
  "JUNIOR_ADMIN",
  "COMMITTEE",
  "DEN",
  "ATTENDANCE_ADMIN",
  "PHOTOGRAPHER",
];

export async function raffleAccessFor(session: Session): Promise<RaffleAccess | null> {
  if (session.role === "ADMIN") return "admin";
  if (RAFFLE_HELPER_ROLES.includes(session.role)) {
    const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { raffleHelper: true } });
    if (user?.raffleHelper) return "helper";
  }
  return session.role === "JUNIOR_ADMIN" ? "viewer" : null;
}

/** For Server Components / pages: the 50/50 raffle pages — see raffleAccessFor. */
export async function requireRaffleAccess(): Promise<{ session: SessionPayload; access: RaffleAccess }> {
  const session = await requireSession();
  const access = await raffleAccessFor(session);
  if (!access) redirect(homeForRole(session.role));
  return { session, access };
}

/**
 * Who may open the pack-wide roster (every den, leader, and scout name):
 * every staff level — Admin, Junior Admin, Committee Member, Den Leader,
 * Attendance Only and Photographer. Never a PARENT account, and never the
 * shared Trip Viewer login. Mirrors the /portal/roster rule in src/proxy.ts.
 *
 * Spelled out role by role rather than "anyone but a PARENT", which is what
 * this used to be: that let the Trip Viewer login through here and left the
 * proxy as the only thing turning it away. A role added later is now kept out
 * until someone decides it belongs on this list.
 */
export const ROSTER_ROLES: SessionPayload["role"][] = [
  "ADMIN",
  "JUNIOR_ADMIN",
  "COMMITTEE",
  "DEN",
  "ATTENDANCE_ADMIN",
  "PHOTOGRAPHER",
];

/** For Server Components / pages: the pack-wide roster — see ROSTER_ROLES. */
export async function requireRosterSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (!ROSTER_ROLES.includes(session.role)) redirect(homeForRole(session.role));
  return session;
}

/**
 * For Server Components / pages: the Committee & Leaders contact list — every
 * staff level (Admin, Junior Admin, Committee Member, Den Leader, Attendance
 * Only, Photographer), view-only except through the Admin-only Manage page.
 * Spelled out role by role, like ROSTER_ROLES, since this is people's personal
 * phone numbers and email addresses and the shared Trip Viewer login mustn't
 * see them. Mirrors the /portal/roster rule in src/proxy.ts.
 */
export const LEADER_CONTACT_ROLES: SessionPayload["role"][] = [
  "ADMIN",
  "JUNIOR_ADMIN",
  "COMMITTEE",
  "DEN",
  "ATTENDANCE_ADMIN",
  "PHOTOGRAPHER",
];

export async function requireLeaderContactsSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (!LEADER_CONTACT_ROLES.includes(session.role)) redirect(homeForRole(session.role));
  return session;
}

/**
 * Exporting the Committee & Leaders list — the CSV and PDF downloads, the
 * Printable View, and the email/copy-addresses buttons: Admin and Junior
 * Admin, the same two roles that export parent contacts. Everyone else who can
 * see the list reads it on screen only.
 */
export function canExportLeaderContacts(session: SessionPayload) {
  return session.role === "ADMIN" || session.role === "JUNIOR_ADMIN";
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
 * just the ones in the Users panel. A master admin account
 * (src/lib/masterAdmins.ts) can only be changed by a master admin; otherwise
 * a regular Admin could reset the master's password and sign in as them.
 * Other Admin accounts, protected or not, are editable by any Admin.
 *
 * That includes the paths outside src/lib/actions/users.ts: the parent
 * contact editor and the Parent Portal revoke button in actions/parents.ts
 * both write through a linked Parent row. Route every such write through
 * here instead of re-deriving the rule.
 */
export async function assertCanMutateUser(session: SessionPayload, target: { username: string }) {
  if (!isMasterAdminUsername(target.username)) return;
  await assertMasterAdmin(session);
}

/**
 * Moving an account into or out of Admin is master-admin only: creating an
 * ADMIN account, promoting someone to ADMIN, or demoting an existing Admin.
 * Demotion has to be covered too, because deleteUserAction only asks for the
 * master admin when the target is still an Admin — an ordinary Admin could
 * otherwise demote another Admin and then delete them. Leaving an existing
 * Admin as Admin, and moves between non-Admin roles, aren't gated here.
 */
export async function assertCanGrantRole(session: SessionPayload, role: string, currentRole?: string) {
  if ((role === "ADMIN") === (currentRole === "ADMIN")) return;
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
