import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { isWellFormedResetToken } from "@/lib/credentialInput";
import type { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";

/*
 * One-time reset/invite links, stored only as SHA-256 hashes.
 *
 * Everything that changes an account's links or password — issuing a link,
 * an Admin reset (actions/users.ts), finishing a link — runs in one short
 * transaction that locks the account's User row before reading anything it
 * decides on. So those steps take turns per account, and each sees what the
 * one before it committed.
 *
 * On top of that lock, each account has a link generation
 * (User.credentialVersion), recorded on every link it issues. Issuing a link,
 * an Admin reset and finishing a link all move the account to a new
 * generation, and a link is only accepted while its generation is still the
 * account's. So an older link — including one someone is in the middle of
 * finishing — stops working the moment a newer one is issued, and exactly one
 * link (the newest) is ever live.
 *
 * bcrypt never runs inside these transactions: finishing a link hashes the new
 * password first and only then opens the transaction, and an Admin reset does
 * the same with its throwaway password. Nothing holds the row locked for the
 * quarter-second a hash takes, and an email is only sent after commit.
 *
 * Rolling the site back past this code: older code issues links without a
 * generation, so they read 0 (the column default) and work as before while
 * that code is live. Once this code is back, such a link is refused as invalid
 * for any account this code had already moved past generation 0, and its
 * owner needs a new link (an Admin's Reset Password). Don't special-case
 * generation 0 to let them through: the generation check is what stops an
 * older link that's mid-way through being finished.
 */

// New-account invites get a longer window than resets since a volunteer may
// not check email right away; resets stay short since they follow an
// intentional admin action and the old password is already dead by then.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 60 minutes
const INVITE_TOKEN_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

/** Interactive-transaction limits for the credential changes above. */
export const CREDENTIAL_TRANSACTION = { timeout: 15_000, maxWait: 10_000 } as const;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Locks the account row until the transaction ends; false if it's gone.
 *
 * FOR NO KEY UPDATE rather than FOR UPDATE: it excludes every other credential
 * change (each one writes this row), but not the key-share lock Postgres takes
 * when some other row is inserted pointing at this account — an audit entry
 * naming it as the actor, say. With FOR UPDATE, two Admins resetting each
 * other at the same moment would each hold one row and wait on the other's
 * audit insert: a deadlock.
 */
export async function lockUserRow(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "User" WHERE id = ${userId} FOR NO KEY UPDATE`;
  return rows.length > 0;
}

/**
 * Issues a new link inside the caller's transaction and returns it. Every
 * earlier link for the account stops working: the account moves to a new
 * generation (an UPDATE, so this also takes the row lock if the caller hasn't
 * already) and the earlier links are marked used. Throws if the account
 * doesn't exist.
 */
export async function issueTokenInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  kind: "reset" | "invite",
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const { credentialVersion } = await tx.user.update({
    where: { id: userId },
    data: { credentialVersion: { increment: 1 } },
    select: { credentialVersion: true },
  });
  // The generation alone already makes them dead; marking them used too keeps
  // each row honest about it.
  await tx.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
  await tx.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + (kind === "invite" ? INVITE_TOKEN_TTL_MS : RESET_TOKEN_TTL_MS)),
      credentialVersion,
    },
  });
  return token;
}

/** For an existing account whose password an admin just invalidated. */
export function issueResetToken(userId: string) {
  return prisma.$transaction((tx) => issueTokenInTransaction(tx, userId, "reset"), CREDENTIAL_TRANSACTION);
}

/** For a brand-new account (admin or den login) that has no usable password yet. */
export function issueInviteToken(userId: string) {
  return prisma.$transaction((tx) => issueTokenInTransaction(tx, userId, "invite"), CREDENTIAL_TRANSACTION);
}

export type ResetLinkStatus = "usable" | "inactive" | "invalid";

/**
 * Read-only: could this link be finished right now? Used to render the
 * "set your password" page and as the cheap check before hashing a new
 * password. It does NOT mark the link used — visiting the link (e.g. an email
 * client's link-scanning bot) must not burn it before the person submits the
 * form. A malformed token never reaches the database.
 */
export async function resetLinkStatus(token: string): Promise<ResetLinkStatus> {
  if (!isWellFormedResetToken(token)) return "invalid";
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      usedAt: true,
      expiresAt: true,
      credentialVersion: true,
      user: { select: { active: true, credentialVersion: true } },
    },
  });
  if (
    !record ||
    record.usedAt ||
    record.expiresAt <= new Date() ||
    record.credentialVersion !== record.user.credentialVersion
  ) {
    return "invalid";
  }
  return record.user.active ? "usable" : "inactive";
}

/** What a finished link signs in as — the committed values, for the session cookie. */
export type RedeemedAccount = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  sessionVersion: number;
  denIds: string[];
  scoutIds: string[];
};

export type RedeemResult = { status: "redeemed"; account: RedeemedAccount } | { status: "invalid" | "inactive" };

/**
 * Finishes a link: spends it and replaces the password with `passwordHash`,
 * which the caller hashed beforehand, all in one transaction. Under the
 * account's row lock it rechecks that the account is active and that the link
 * is unused, unexpired and still the account's current generation — the
 * spend itself is a conditional write with all of those in its WHERE — then
 * sets the password, revokes every session (sessionVersion) and moves the
 * account to a new generation, which kills every other outstanding link.
 * `beforeCommit` runs in the same transaction (the audit entry), so the
 * change and its record commit or roll back together.
 *
 * Anything that throws rolls the whole thing back, spend included: a failed
 * password write leaves the link usable for another try. A refusal
 * ("invalid", "inactive") writes nothing.
 */
export async function redeemResetToken(
  token: string,
  passwordHash: string,
  beforeCommit: (tx: Prisma.TransactionClient, account: RedeemedAccount) => Promise<void>,
): Promise<RedeemResult> {
  if (!isWellFormedResetToken(token)) return { status: "invalid" };
  const tokenHash = hashToken(token);

  return prisma.$transaction(async (tx): Promise<RedeemResult> => {
    // Only to learn whose link it is (that never changes); every decision is
    // made below, under the account's lock.
    const record = await tx.passwordResetToken.findUnique({ where: { tokenHash }, select: { id: true, userId: true } });
    if (!record) return { status: "invalid" };
    if (!(await lockUserRow(tx, record.userId))) return { status: "invalid" };

    const user = await tx.user.findUniqueOrThrow({
      where: { id: record.userId },
      select: { active: true, credentialVersion: true },
    });
    // A link can outlive the account being switched off; it isn't spent, and
    // works again only if the account is switched back on before it expires.
    if (!user.active) return { status: "inactive" };

    // The clock is read now, after any wait for the lock, and the expiry check
    // is part of the write itself — so a link that ran out while this request
    // was hashing or queued behind another change is refused.
    const now = new Date();
    const spent = await tx.passwordResetToken.updateMany({
      where: {
        id: record.id,
        usedAt: null,
        expiresAt: { gt: now },
        credentialVersion: user.credentialVersion,
      },
      data: { usedAt: now },
    });
    if (spent.count !== 1) return { status: "invalid" };

    const updated = await tx.user.update({
      where: { id: record.userId },
      data: {
        passwordHash,
        failedLoginCount: 0,
        lockedUntil: null,
        sessionVersion: { increment: 1 },
        credentialVersion: { increment: 1 },
      },
      select: { id: true, username: true, displayName: true, role: true, sessionVersion: true },
    });
    await tx.passwordResetToken.updateMany({ where: { userId: record.userId, usedAt: null }, data: { usedAt: now } });

    const denAssignments = await tx.denAssignment.findMany({ where: { userId: updated.id }, select: { denId: true } });
    const parentContacts = await tx.parent.findMany({
      where: { userId: updated.id },
      select: { scoutId: true },
      distinct: ["scoutId"],
    });
    const account: RedeemedAccount = {
      ...updated,
      denIds: denAssignments.map((a) => a.denId),
      // Deduped: a scout can have more than one Parent row pointing at the same
      // login (two contacts for one guardian, or a re-invite), and duplicate ids
      // reach every `in: scoutIds` query the dashboard runs — where they break
      // relation hydration and null out an included den.
      scoutIds: [...new Set(parentContacts.map((p) => p.scoutId))],
    };
    await beforeCommit(tx, account);
    return { status: "redeemed", account };
  }, CREDENTIAL_TRANSACTION);
}
