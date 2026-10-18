/**
 * The master admin(s): full access, including the audit log, Start a Fresh
 * Year, and creating or deleting Admin accounts. Master status is decided by
 * username, on top of role ADMIN. To add or remove one, edit this list in
 * code and deploy.
 */
export const MASTER_ADMIN_USERNAMES = ["mattrosen"];

/**
 * Accounts that can never be deleted from the admin panel, by anyone. Every
 * master admin is protected; the others here are ordinary Admins, and any
 * Admin can still edit them. To remove one, edit this list in code and
 * deploy.
 */
export const PROTECTED_USERNAMES = [...MASTER_ADMIN_USERNAMES, "howell", "dianaliz"];

export function isMasterAdminUsername(username: string) {
  return MASTER_ADMIN_USERNAMES.includes(username.trim().toLowerCase());
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
