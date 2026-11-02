/**
 * The master admin(s): full access, including the audit log, Start a Fresh
 * Year, and creating or deleting Admin accounts. Master status is decided by
 * username, on top of role ADMIN. To add or remove one, edit this list in
 * code and deploy.
 */
export const MASTER_ADMIN_USERNAMES = ["mattrosen"];

/**
 * Who keeps the pack's books: only these accounts can open the Ledger
 * (/portal/admin/ledger) — read it, add to it, or export it. Decided by
 * username on top of role ADMIN, like the master admins. To change who, edit
 * this list in code and deploy; every name here must also be in
 * PROTECTED_USERNAMES (a unit test checks), so the name can never be deleted
 * and then recreated by someone else.
 *
 * Beta (from 2026-11-02): mattrosen only. Add "dianaliz" back when the beta
 * ends — that also makes her account master-only to change again.
 */
export const LEDGER_USERNAMES = ["mattrosen"];

/**
 * Accounts that can never be deleted from the admin panel, by anyone. Every
 * master admin is protected; the others here are ordinary Admins. Any Admin
 * can still edit howell; a ledger account (LEDGER_USERNAMES) is only a
 * master admin's to change — see isMasterOnlyMutableUsername. To remove one,
 * edit this list in code and deploy.
 */
export const PROTECTED_USERNAMES = [...MASTER_ADMIN_USERNAMES, "howell", "dianaliz"];

export function isMasterAdminUsername(username: string) {
  return MASTER_ADMIN_USERNAMES.includes(username.trim().toLowerCase());
}

export function isLedgerUsername(username: string) {
  return LEDGER_USERNAMES.includes(username.trim().toLowerCase());
}

/**
 * Accounts only a master admin may change — password reset, email, phone,
 * display name and the rest: the master admins themselves, and the ledger
 * accounts, since whoever controls one of those logins reads and writes the
 * pack's books. Without this an ordinary Admin could reset a ledger account's
 * password and, if it has no email, be shown the new link on screen.
 */
export function isMasterOnlyMutableUsername(username: string) {
  return isMasterAdminUsername(username) || isLedgerUsername(username);
}

export function isProtectedUsername(username: string) {
  return PROTECTED_USERNAMES.includes(username.trim().toLowerCase());
}

/**
 * Who may be switched inactive from the Users panel — shared with the page, so
 * the button is only drawn where the action would go through. An inactive
 * login can't sign in, so the same people who can't be deleted can't be
 * switched off either (that would lock them out just the same), and neither
 * can the acting admin's own account. Taking an Admin off is the master
 * admin's call, like deleting one.
 */
export function canSetUserActive(
  viewer: { userId: string; isMaster: boolean },
  target: { id: string; username: string; role: string }
) {
  if (target.role === "PARENT") return false;
  if (isProtectedUsername(target.username)) return false;
  if (target.id === viewer.userId) return false;
  if (target.role === "ADMIN" && !viewer.isMaster) return false;
  return true;
}
