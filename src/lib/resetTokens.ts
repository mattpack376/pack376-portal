import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

// New-account invites get a longer window than resets since a volunteer may
// not check email right away; resets stay short since they follow an
// intentional admin action and the old password is already dead by then.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 60 minutes
const INVITE_TOKEN_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Invalidates any tokens already outstanding for this user before issuing the
 * new one, in the same transaction — otherwise an older reset/invite link
 * stays live (and usable) alongside whatever this call is about to hand out.
 */
async function issueToken(userId: string, ttlMs: number) {
  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.create({
      data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) },
    }),
  ]);
  return token;
}

/** For an existing account whose password an admin just invalidated. */
export function issueResetToken(userId: string) {
  return issueToken(userId, RESET_TOKEN_TTL_MS);
}

/** For a brand-new account (admin or den login) that has no usable password yet. */
export function issueInviteToken(userId: string) {
  return issueToken(userId, INVITE_TOKEN_TTL_MS);
}

/**
 * Read-only validity check for rendering the "set your password" page —
 * does NOT mark the token used. Visiting the link (e.g. an email client's
 * link-scanning bot) must not burn it before the person submits the form.
 */
export async function peekResetToken(token: string): Promise<boolean> {
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  return !!record && !record.usedAt && record.expiresAt > new Date();
}

/**
 * Atomically marks a token used and returns its owning userId, or null if the
 * token doesn't exist, is expired, or was already used. `updateMany`'s WHERE
 * re-checks `usedAt: null` at the database level, so two simultaneous
 * redemptions of the same link can't both succeed — the loser gets count: 0.
 *
 * Also invalidates every other outstanding token for the same user in the
 * same transaction — issueToken already does this on issue, but this covers
 * tokens that predate that behavior, or any issued concurrently with redemption.
 */
export async function redeemResetToken(token: string): Promise<{ userId: string } | null> {
  const tokenHash = hashToken(token);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!record || record.usedAt || record.expiresAt < new Date()) return null;

  const [{ count }] = await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { tokenHash, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null, NOT: { tokenHash } },
      data: { usedAt: new Date() },
    }),
  ]);
  if (count === 0) return null;

  return { userId: record.userId };
}
