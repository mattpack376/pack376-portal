/**
 * Shapes and limits for what a visitor types into the sign-in and
 * set-your-password forms. The actions check these before any database or
 * bcrypt work, so a junk or oversized request costs next to nothing. No
 * server-only imports, so the forms can show the same numbers.
 */
import { MAX_EMAIL_LENGTH } from "@/lib/formValues";

/** Shortest new password accepted. */
export const MIN_PASSWORD_LENGTH = 8;

/** bcrypt reads only the first 72 bytes of a password and ignores the rest. */
export const MAX_PASSWORD_BYTES = 72;

/**
 * Longest password either form accepts at all, checked before anything else
 * runs. No one types this much: it's there so junk costs nothing.
 *
 * Deliberately above MAX_PASSWORD_BYTES. On sign-in, a password set before
 * that limit was enforced can be longer (bcrypt only ever compared its first
 * 72 bytes), and it has to keep working. On the reset form, everything from
 * here down to 72 bytes is refused only after the link check, so someone
 * holding a dead link hears that first instead of fixing a password for
 * nothing.
 */
export const MAX_PASSWORD_INPUT_LENGTH = 1024;

/** Parent Portal logins are email addresses, so a username can be as long as one. */
export const MAX_USERNAME_LENGTH = MAX_EMAIL_LENGTH;

/** Every reset/invite link carries randomBytes(32) in base64url: 43 characters. */
const RESET_TOKEN_LENGTH = 43;
const RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** True for something shaped like a real link token; says nothing about whether it's live. */
export function isWellFormedResetToken(token: unknown): token is string {
  // The length test first, so a huge string is turned away without scanning it.
  return typeof token === "string" && token.length === RESET_TOKEN_LENGTH && RESET_TOKEN_PATTERN.test(token);
}

/**
 * Why a reset/invite link can't be finished, and how the page says so. The
 * reset page uses this when it first loads a dead link, and the form uses the
 * same words when a submit finds the link dead, so both views match.
 */
export const DEAD_LINK_TEXT = {
  invalid: {
    heading: "Link Invalid",
    message: "This link is invalid, expired, or has already been used. Ask an admin to send you a new one.",
  },
  inactive: {
    heading: "Account Inactive",
    message: "This account is inactive. Ask an admin to make it active again, then request a new link.",
  },
} as const;

export type DeadLinkReason = keyof typeof DEAD_LINK_TEXT;

/** UTF-8 length, the way bcrypt counts a password. */
export function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export type NewPasswordProblem = { error: string; field: "password" | "confirmPassword" };

const PASSWORD_TOO_LONG: NewPasswordProblem = {
  field: "password",
  error: "Password is too long. Please use 72 characters or fewer (accented letters and emoji count as more than one).",
};
const PASSWORDS_DIFFER: NewPasswordProblem = { field: "confirmPassword", error: "Passwords don't match." };

/**
 * The reset form's first check, before the link is even looked up: either
 * field past MAX_PASSWORD_INPUT_LENGTH. It reports what newPasswordProblem
 * would say about the same input, so the wording never depends on which
 * check caught it (a confirmation that long can't match a password that
 * isn't).
 */
export function oversizePasswordProblem(password: string, confirmPassword: string): NewPasswordProblem | null {
  if (password.length > MAX_PASSWORD_INPUT_LENGTH) return PASSWORD_TOO_LONG;
  if (confirmPassword.length > MAX_PASSWORD_INPUT_LENGTH) return PASSWORDS_DIFFER;
  return null;
}

/** Why a new password (and its confirmation) can't be used, or null if it can. */
export function newPasswordProblem(password: string, confirmPassword: string): NewPasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { field: "password", error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  // bcrypt silently ignores everything after 72 bytes, so two passwords
  // sharing that prefix would hash identically, and someone typing a long
  // passphrase would reasonably assume every character counts. A string over
  // 72 UTF-16 units is over 72 bytes too, so that cheap check settles a huge
  // paste before any bytes are counted.
  if (password.length > MAX_PASSWORD_BYTES || utf8ByteLength(password) > MAX_PASSWORD_BYTES) {
    return PASSWORD_TOO_LONG;
  }
  if (password !== confirmPassword) return PASSWORDS_DIFFER;
  return null;
}
