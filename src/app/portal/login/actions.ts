"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { checkRateLimit } from "@vercel/firewall";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSessionCookie, isLockedOut, lockedUntilForCount } from "@/lib/auth";
import { recordAuditAs, UNKNOWN_ACCOUNT_ACTOR, type AuditActor } from "@/lib/audit";

export type LoginState = { error?: string };

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
  const { rateLimited } = await checkRateLimit("portal-login", { headers: await headers() });
  if (rateLimited) {
    // Deliberately not audited. This branch exists to stop doing work for a
    // flood of requests, and writing a row per blocked attempt would hand that
    // flood a database write each — turning the defence into the amplifier it
    // is there to prevent. The rate limiter's own metrics cover this case.
    return { error: "Too many login attempts. Try again in a few minutes." };
  }

  const username = String(formData.get("username") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");

  if (!username || !password) {
    return { error: "Enter a username and password." };
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    // Burn the same bcrypt time a real login would, then fail identically.
    await verifyPassword(password, TIMING_DUMMY_HASH);
    await recordAuditAs(UNKNOWN_ACCOUNT_ACTOR, {
      action: "auth.failed",
      summary: "Failed sign-in for a username that doesn't match any account",
    });
    return { error: "Invalid username or password." };
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
    });
    return { error: "Too many failed attempts. Try again in about 15 minutes." };
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
      details: [{ label: "Consecutive failures", from: String(failedLoginCount - 1), to: String(failedLoginCount) }],
    });
    return lockedUntil
      ? { error: "Too many failed attempts. Try again in about 15 minutes." }
      : { error: "Invalid username or password." };
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
