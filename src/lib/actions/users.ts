"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import { assertAdmin, assertMasterAdmin } from "@/lib/authorize";
import { generatePassword } from "@/lib/passwords";
import { issueInviteToken, issueResetToken } from "@/lib/resetTokens";
import { getAppBaseUrl } from "@/lib/appUrl";
import { isMasterAdminUsername } from "@/lib/masterAdmins";
import { ASSIGNABLE_ROLES, DEN_ASSIGNABLE_ROLES, type AssignableRole } from "@/lib/roleLabels";
import { sendAccountLinkEmail } from "@/lib/email";
import type { CreatedInvite } from "@/lib/actions/dens";

export async function createAdminAction(
  username: string,
  displayName: string,
  role: AssignableRole = "ADMIN",
  email?: string
) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authorized." };
  try {
    assertAdmin(session);
  } catch {
    return { ok: false as const, error: "Not authorized." };
  }

  if (!ASSIGNABLE_ROLES.includes(role)) {
    return { ok: false as const, error: "Invalid role." };
  }

  const clean = username.trim().toLowerCase();
  const name = displayName.trim();
  const cleanEmail = email?.trim() || null;
  if (!clean || !name) return { ok: false as const, error: "Username and display name are required." };

  const existing = await prisma.user.findUnique({ where: { username: clean } });
  if (existing) return { ok: false as const, error: "That username is already taken." };

  // No password is ever generated server-side for anyone to see — the account
  // starts with a random, immediately-discarded hash, and the new user sets
  // their own password via a one-time invite link.
  const user = await prisma.user.create({
    data: {
      username: clean,
      passwordHash: await hashPassword(generatePassword()),
      role,
      displayName: name,
      email: cleanEmail,
    },
  });

  revalidatePath("/portal/admin/users");

  const token = await issueInviteToken(user.id);
  const url = `${getAppBaseUrl()}/portal/reset/${token}`;

  if (cleanEmail) {
    const { sent } = await sendAccountLinkEmail(cleanEmail, { username: clean, url, isNewAccount: true });
    if (sent) return { ok: true as const, emailedTo: cleanEmail };
  }
  const invite: CreatedInvite = { username: clean, url };
  return { ok: true as const, invite };
}

export async function resetPasswordAction(userId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authorized." };
  try {
    assertAdmin(session);
  } catch {
    return { ok: false as const, error: "Not authorized." };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false as const, error: "User not found." };

  // Only a master admin can reset another master admin's password. Without this,
  // a regular admin could reset a protected account's credentials and — if that
  // account has no email — have the new password revealed to them on screen.
  if (isMasterAdminUsername(user.username)) {
    try {
      await assertMasterAdmin(session);
    } catch {
      return { ok: false as const, error: "Only a master admin can reset a master admin's password." };
    }
  }

  // Immediately kill the current password and any live sessions — matching
  // the confirm dialog's promise that "the old password will stop working
  // immediately" — then send a one-time link so the user picks their own
  // replacement. The server never generates or sees the new password.
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(generatePassword()),
      failedLoginCount: 0,
      lockedUntil: null,
      sessionVersion: { increment: 1 },
    },
  });

  revalidatePath("/portal/admin/users");

  const token = await issueResetToken(userId);
  const url = `${getAppBaseUrl()}/portal/reset/${token}`;

  if (user.email) {
    const { sent } = await sendAccountLinkEmail(user.email, {
      username: user.username,
      url,
      isNewAccount: false,
    });
    if (sent) return { ok: true as const, emailedTo: user.email };
  }
  const invite: CreatedInvite = { username: user.username, url };
  return { ok: true as const, invite };
}

export async function updateUserEmailAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const userId = String(formData.get("userId") || "");
  const email = String(formData.get("email") || "").trim();

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
  if (!user) throw new Error("User not found.");
  // A master admin's contact identity can only be changed by another master admin.
  if (isMasterAdminUsername(user.username)) await assertMasterAdmin(session);

  await prisma.user.update({ where: { id: userId }, data: { email: email || null } });

  revalidatePath(`/portal/admin/users/${userId}`);
}

export async function updateUserDisplayNameAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const userId = String(formData.get("userId") || "");
  const displayName = String(formData.get("displayName") || "").trim();
  if (!displayName) throw new Error("Display name is required.");

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
  if (!user) throw new Error("User not found.");
  // A master admin's display identity can only be changed by another master admin.
  if (isMasterAdminUsername(user.username)) await assertMasterAdmin(session);

  await prisma.user.update({ where: { id: userId }, data: { displayName } });

  revalidatePath(`/portal/admin/users/${userId}`);
  revalidatePath("/portal/admin/users");
  revalidatePath("/portal/admin");
  revalidatePath("/portal/roster");
}

export type UpdateUserRoleState = { error?: string };

/**
 * Changes an account between the four assignable roles (Admin, Junior
 * Admin, Attendance Only, Photographer). Den logins aren't editable here —
 * they're tied to a specific den and managed from that den's page. Master
 * admins can't be changed through the UI at all; see src/lib/masterAdmins.ts.
 */
export async function updateUserRoleAction(
  _prevState: UpdateUserRoleState,
  formData: FormData
): Promise<UpdateUserRoleState> {
  const session = await getSession();
  if (!session) return { error: "Not authorized." };
  try {
    assertAdmin(session);
  } catch {
    return { error: "Not authorized." };
  }

  const userId = String(formData.get("userId") || "");
  const role = String(formData.get("role") || "");
  if (!ASSIGNABLE_ROLES.includes(role as AssignableRole)) {
    return { error: "Invalid role." };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { error: "User not found." };
  if (isMasterAdminUsername(user.username)) {
    return { error: "Master admins can't be changed from the admin panel." };
  }

  // Revoke existing sessions so the old role in their JWT stops being honored.
  await prisma.user.update({
    where: { id: userId },
    data: { role: role as AssignableRole, sessionVersion: { increment: 1 } },
  });
  if (user.role === "DEN" && role !== "DEN") {
    await prisma.denAssignment.deleteMany({ where: { userId } });
  }

  revalidatePath("/portal/admin/users");
  revalidatePath(`/portal/admin/users/${userId}`);
  redirect("/portal/admin/users");
}

export async function updateUserDensAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const userId = String(formData.get("userId") || "");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("User not found.");
  if (!DEN_ASSIGNABLE_ROLES.includes(user.role as (typeof DEN_ASSIGNABLE_ROLES)[number])) {
    throw new Error("This account's role can't be assigned to dens.");
  }

  const denIds = formData.getAll("denIds").map(String);

  await prisma.$transaction([
    prisma.denAssignment.deleteMany({ where: { userId } }),
    prisma.denAssignment.createMany({ data: denIds.map((denId) => ({ userId, denId })) }),
    // Revoke existing sessions so the old denIds in their JWT stop granting access.
    prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } }),
  ]);

  revalidatePath(`/portal/admin/users/${userId}`);
  revalidatePath("/portal/admin");
}

export async function deleteUserAction(userId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authorized." };
  try {
    assertAdmin(session);
  } catch {
    return { ok: false as const, error: "Not authorized." };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false as const, error: "User not found." };
  if (isMasterAdminUsername(user.username)) {
    return { ok: false as const, error: "This is a protected master admin account and can't be deleted from the admin panel." };
  }
  if (userId === session.userId) {
    return { ok: false as const, error: "You can't delete your own account while logged in." };
  }

  await prisma.user.delete({ where: { id: userId } });

  revalidatePath("/portal/admin/users");
  revalidatePath(`/portal/admin/users/${userId}`);
  return { ok: true as const };
}
