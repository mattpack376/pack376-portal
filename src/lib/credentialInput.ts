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
 * Longest password the sign-in form passes on to bcrypt. Deliberately above
 * MAX_PASSWORD_BYTES: a password set before that limit was enforced can be
 * longer (bcrypt only ever compared its first 72 bytes), and it has to keep
 * working. Anything past this is junk, not a forgotten passphrase.
 */
export const MAX_SIGN_IN_PASSWORD_LENGTH = 1024;

/** Parent Portal logins are email addresses, so a username can be as long as one. */
export const MAX_USERNAME_LENGTH = MAX_EMAIL_LENGTH;

/** Every reset/invite link carries randomBytes(32) in base64url: 43 characters. */
const RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** True for something shaped like a real link token; says nothing about whether it's live. */
export function isWellFormedResetToken(token: unknown): token is string {
  return typeof token === "string" && RESET_TOKEN_PATTERN.test(token);
}

/** UTF-8 length, the way bcrypt counts a password. */
export function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export type NewPasswordProblem = { error: string; field: "password" | "confirmPassword" };

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
    return {
      field: "password",
      error: "Password is too long. Please use 72 characters or fewer (accented letters and emoji count as more than one).",
    };
  }
  if (password !== confirmPassword) {
    return { field: "confirmPassword", error: "Passwords don't match." };
  }
  return null;
}
