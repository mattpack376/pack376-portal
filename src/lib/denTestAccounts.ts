/**
 * Den Leader test logins: a Den Leader account listed here gets the Den
 * Leader view of every den — advancement, attendance, parent contacts, Family
 * View, photo consent — so that level can be tried out against any den.
 *
 * The access comes from the username, not from den assignments, so the
 * account is never listed as a den's leader on the roster, the dashboard or
 * the den pages. It only applies while the account is at the Den Leader
 * level. To add or remove one, edit this list in code and deploy.
 */
export const ALL_DENS_TEST_USERNAMES = ["denmatt"];

export function isAllDensTestUsername(username: string) {
  return ALL_DENS_TEST_USERNAMES.includes(username.trim().toLowerCase());
}
