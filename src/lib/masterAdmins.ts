/**
 * The master admin(s): full access, including the audit log, Start a Fresh
 * Year, and creating other Admin accounts. Master status is decided by
 * username, on top of role ADMIN. To add or remove one, edit this list in
 * code and deploy.
 */
export const MASTER_ADMIN_USERNAMES = ["mattrosen"];

/**
 * Accounts that can never be deleted from the admin panel, and that only a
 * master admin may change (role, password, name, email, phone) — apart from
 * the account's own contact details. Every master admin is protected; the
 * others here are ordinary Admins. To remove one, edit this list in code and
 * deploy.
 */
export const PROTECTED_USERNAMES = [...MASTER_ADMIN_USERNAMES, "howell", "dianaliz"];

export function isMasterAdminUsername(username: string) {
  return MASTER_ADMIN_USERNAMES.includes(username.trim().toLowerCase());
}

export function isProtectedUsername(username: string) {
  return PROTECTED_USERNAMES.includes(username.trim().toLowerCase());
}
