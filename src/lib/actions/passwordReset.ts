"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { hashPassword, createSessionCookie } from "@/lib/auth";
import { redeemResetToken } from "@/lib/resetTokens";

export type CompleteResetState = { error?: string };

const MIN_PASSWORD_LENGTH = 8;

/**
 * Redeems a one-time invite/reset token, lets the account holder set their
 * own password, and signs them straight in — mirroring loginAction's session
 * setup. sessionVersion is bumped again here (on top of whatever bumped it
 * when the reset was initiated) so this stays correct even for flows, like
 * new-account invites, that never bumped it in the first place.
 */
export async function completeResetAction(
  _prevState: CompleteResetState,
  formData: FormData
): Promise<CompleteResetState> {
  const token = String(formData.get("token") || "");
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (!token) return { error: "Missing or invalid link." };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  // bcrypt only looks at the first 72 bytes of input and silently ignores the
  // rest — without this check, two different passwords sharing that prefix
  // would hash identically, and a user typing a long passphrase would
  // reasonably assume every character they typed matters.
  if (bcrypt.truncates(password)) {
    return { error: "Password is too long. Please use a password under 72 bytes (about 72 characters)." };
  }
  if (password !== confirmPassword) {
    return { error: "Passwords don't match." };
  }

  const redeemed = await redeemResetToken(token);
  if (!redeemed) {
    return { error: "This link is invalid, expired, or has already been used. Ask an admin to send a new one." };
  }

  const user = await prisma.user.update({
    where: { id: redeemed.userId },
    data: {
      passwordHash: await hashPassword(password),
      failedLoginCount: 0,
      lockedUntil: null,
      sessionVersion: { increment: 1 },
    },
  });

  const [denAssignments, parentContacts] = await Promise.all([
    prisma.denAssignment.findMany({ where: { userId: user.id }, select: { denId: true } }),
    prisma.parent.findMany({ where: { userId: user.id }, select: { scoutId: true }, distinct: ["scoutId"] }),
  ]);
  await createSessionCookie({
    userId: user.id,
    role: user.role,
    denIds: denAssignments.map((a) => a.denId),
    scoutIds: parentContacts.map((p) => p.scoutId),
    displayName: user.displayName,
    sv: user.sessionVersion,
  });

  redirect("/portal");
}
