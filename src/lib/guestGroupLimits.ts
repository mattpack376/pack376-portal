/*
 * Limits for event guest groups and the one-time keys their sign-up forms
 * carry. The Server Actions in src/lib/actions/events.ts enforce these; the
 * forms only use them as hints (max=, maxLength=). Plain values with no
 * imports, so client components can use them too.
 */

/**
 * The most people, adults and kids together, one guest group signed up
 * online can hold. Set by the pack on 2026-10-27: a bigger group goes through
 * an Admin, who can check it's real before it lands on the roster and the
 * balance sheet.
 */
export const SELF_SERVICE_GUEST_GROUP_MAX_PEOPLE = 10;

/**
 * How many guest groups one login can have signed up for one event at a
 * time. More than one, because a family sometimes splits its guests
 * (grandparents paying separately); it only stops a script, or a button
 * pressed over and over, from filling the roster. Withdrawing a group frees
 * its place. An Admin can still add more by hand.
 */
export const SELF_SERVICE_GUEST_GROUPS_PER_EVENT = 5;

/**
 * The most people in a guest group an Admin enters or edits by hand. Far
 * above any real group (a visiting troop is a few dozen), but it still
 * catches a typo like 1000 for 10 before it becomes a balance.
 */
export const ADMIN_GUEST_GROUP_MAX_PEOPLE = 200;

/**
 * A fresh key for one rendering of a sign-up form, sent back in a hidden
 * field. The action stores it on the group it creates, so the same form sent
 * twice (a double tap, a retried request) makes one group, while the next
 * rendering of the form gets a new key and can add another.
 */
export function newSubmissionKey(): string {
  return crypto.randomUUID();
}

/** The shape newSubmissionKey produces; anything else is refused before it's stored. */
export function isSubmissionKey(value: string): boolean {
  return /^[A-Za-z0-9-]{16,64}$/.test(value);
}
