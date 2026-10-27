"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { checkRateLimit } from "@vercel/firewall";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSessionCookie, isLockedOut, lockedUntilForCount } from "@/lib/auth";
import { recordAuditAs, clientIpFromHeaders, UNKNOWN_ACCOUNT_ACTOR, type AuditActor } from "@/lib/audit";
import { clientDeviceFromHeaders, clientLocationFromHeaders } from "@/lib/clientInfo";
import { MAX_SIGN_IN_PASSWORD_LENGTH, MAX_USERNAME_LENGTH } from "@/lib/credentialInput";

/**
 * `username` is what was typed, normalized, handed back after a refusal so
 * the form can keep it filled in. The password never comes back.
 */
export type LoginState = { error?: string; username?: string };

// A real cost-12 bcrypt hash used only to equalize response time when the
// username doesn't exist. Without it, "no such user" returns before any bcrypt
// work while "wrong password" pays the full compare, letting an attacker
// enumerate valid usernames by timing. The plaintext behind this hash is
// irrelevant — it will never match a submitted password.
const TIMING_DUMMY_HASH = "$2b$12$T8KZcTJ2XebuePfsQWn97ueyg9eYenLYnQgR1kE4h/I.LGaUaYE3i";

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  // Caps attempts per IP before any DB/bcrypt work runs, regardless of
  // whether the username exists — closing the CPU-cost DoS the dummy-hash
  // timing fix above otherwise leaves open. Enforced by a matching "portal-login"
  // rate limit rule in the Vercel Firewall dashboard; fails open (no-op) if that
  // rule isn't configured, so this alone doesn't throttle anything by itself.
  const headerList = await headers();
  const { rateLimited, error: rateLimitError } = await checkRateLimit("portal-login", { headers: headerList });
  // Failing open is silent otherwise — this line in the Vercel logs is the
  // only sign the Firewall rule is gone.
  if (rateLimitError === "not-found") console.error('[rate limit] no "portal-login" rule in the Vercel Firewall');
  if (rateLimited) {
    // Deliberately not audited. This branch exists to stop doing work for a
    // flood of requests, and writing a row per blocked attempt would hand that
    // flood a database write each — turning the defence into the amplifier it
    // is there to prevent. The rate limiter's own metrics cover this case.
    return { error: "Too many login attempts. Try again in a few minutes." };
  }

  // Captured once and attached to every sign-in outcome below, so a run of
  // failures can be read as "all from one address" or "from several". Device
  // and place are recorded here and nowhere else in the audit log — they're
  // wanted for sign-ins and failed attempts only.
  const clientInfo = {
    ipAddress: clientIpFromHeaders(headerList),
    deviceInfo: clientDeviceFromHeaders(headerList),
    location: clientLocationFromHeaders(headerList),
  };

  const rawUsername = formData.get("username");
  const rawPassword = formData.get("password");
  const username = typeof rawUsername === "string" ? rawUsername.trim().toLowerCase() : "";
  const password = typeof rawPassword === "string" ? rawPassword : "";

  // Nothing longer than these can be a real login, so it's refused before the
  // database or bcrypt sees it. Not audited, like the rate-limited case above:
  // an entry per junk request would be the flood's amplifier, and these can
  // never sign in anyway. No account is looked up, so the reply says nothing
  // about which usernames exist.
  if (username.length > MAX_USERNAME_LENGTH || password.length > MAX_SIGN_IN_PASSWORD_LENGTH) {
    return { error: "Invalid username or password." };
  }

  if (!username || !password) {
    return { error: "Enter a username and password.", username };
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    // Burn the same bcrypt time a real login would, then fail identically.
    await verifyPassword(password, TIMING_DUMMY_HASH);
    await recordAuditAs(UNKNOWN_ACCOUNT_ACTOR, {
      action: "auth.failed",
      summary: "Failed sign-in for a username that doesn't match any account",
      ...clientInfo,
    });
    return { error: "Invalid username or password.", username };
  }

  // Every entry below is about this account, but says nothing about who was at
  // the keyboard — a failed attempt is as likely to be someone else as the
  // account holder. Summaries are worded "for <account>", never "<account>
  // did", so the Who column is never read as an accusation.
  const actor: AuditActor = {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  };

  if (isLockedOut(user.lockedUntil)) {
    await recordAuditAs(actor, {
      action: "auth.blocked",
      summary: `Sign-in attempt for “${user.username}” while the account was locked out`,
      entityType: "User",
      entityId: user.id,
      ...clientInfo,
    });
    return { error: "Too many failed attempts. Try again in about 15 minutes.", username };
  }

  // A lock that has since expired otherwise leaves failedLoginCount sitting
  // at the threshold forever — nothing resets it except a successful login —
  // so a single mistake after the lock lifts would immediately re-lock the
  // account instead of requiring a fresh run of failures. Scoping the WHERE
  // to lockedUntil: not null makes this a no-op if a concurrent request
  // already reset it, rather than a second redundant write.
  if (user.lockedUntil) {
    await prisma.user.updateMany({
      where: { id: user.id, lockedUntil: { not: null } },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    // Atomic increment against whatever's currently in the database, not a
    // value read earlier in this request — so two concurrent failed guesses
    // on the same account can't both read the same starting count and
    // overwrite each other down to a single increment.
    const { failedLoginCount } = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    const lockedUntil = lockedUntilForCount(failedLoginCount);
    if (lockedUntil) {
      await prisma.user.update({ where: { id: user.id }, data: { lockedUntil } });
    }
    await recordAuditAs(actor, {
      action: "auth.failed",
      summary: lockedUntil
        ? `Wrong password for “${user.username}” — ${failedLoginCount} failed attempts in a row, account now locked for 15 minutes`
        : `Wrong password for “${user.username}” (${failedLoginCount} failed attempt${failedLoginCount === 1 ? "" : "s"} in a row)`,
      entityType: "User",
      entityId: user.id,
      ...clientInfo,
      details: [{ label: "Consecutive failures", from: String(failedLoginCount - 1), to: String(failedLoginCount) }],
    });
    return lockedUntil
      ? { error: "Too many failed attempts. Try again in about 15 minutes.", username }
      : { error: "Invalid username or password.", username };
  }

  // Checked only after the password is right, so a wrong guess can't be used
  // to learn which usernames exist and are switched off.
  if (!user.active) {
    await recordAuditAs(actor, {
      action: "auth.blocked",
      summary: `Sign-in attempt for “${user.username}” while the account was inactive`,
      entityType: "User",
      entityId: user.id,
      ...clientInfo,
    });
    return { error: "This account is inactive. Ask an admin to make it active again.", username };
  }

  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  const [denAssignments, parentContacts] = await Promise.all([
    prisma.denAssignment.findMany({ where: { userId: user.id }, select: { denId: true } }),
    prisma.parent.findMany({ where: { userId: user.id }, select: { scoutId: true }, distinct: ["scoutId"] }),
  ]);
  await createSessionCookie({
    userId: user.id,
    role: user.role,
    denIds: denAssignments.map((a) => a.denId),
    // Deduped: a scout can have more than one Parent row pointing at the same
    // login (two contacts for one guardian, or a re-invite), and duplicate ids
    // here reach every `in: scoutIds` query the dashboard runs — where they
    // break relation hydration and null out an included den.
    scoutIds: [...new Set(parentContacts.map((p) => p.scoutId))],
    displayName: user.displayName,
    sv: user.sessionVersion,
  });

  await recordAuditAs(actor, {
    action: "auth.signIn",
    summary: `Signed in as “${user.username}” (${user.displayName})`,
    entityType: "User",
    entityId: user.id,
    ...clientInfo,
    // Worth surfacing: a success straight after failures is the ordinary
    // "mistyped it twice" story, and its absence is what makes a run of
    // failures with no success interesting.
    details:
      user.failedLoginCount > 0
        ? [{ label: "Failed attempts cleared", from: String(user.failedLoginCount), to: "0" }]
        : null,
  });

  redirect("/portal");
}
