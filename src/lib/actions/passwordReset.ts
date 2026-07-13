"use server";

import { redirect } from "next/navigation";
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

  const denAssignments = await prisma.denAssignment.findMany({
    where: { userId: user.id },
    select: { denId: true },
  });
  await createSessionCookie({
    userId: user.id,
    role: user.role,
    denIds: denAssignments.map((a) => a.denId),
    displayName: user.displayName,
    sv: user.sessionVersion,
  });

  redirect("/portal");
}
