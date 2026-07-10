/**
 * Usernames that can never be deleted or demoted through the admin panel.
 * To remove or change one of these accounts, edit this list in code and deploy.
 */
export const MASTER_ADMIN_USERNAMES = ["mattrosen", "howell", "dianaliz"];

export function isMasterAdminUsername(username: string) {
  return MASTER_ADMIN_USERNAMES.includes(username.trim().toLowerCase());
}
