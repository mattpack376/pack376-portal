"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import { assertAdmin, assertMasterAdmin } from "@/lib/authorize";
import { generatePassword } from "@/lib/passwords";
import { isMasterAdminUsername } from "@/lib/masterAdmins";
import { ASSIGNABLE_ROLES, DEN_ASSIGNABLE_ROLES, type AssignableRole } from "@/lib/roleLabels";
import { sendCredentialEmail } from "@/lib/email";
import type { CreatedCredential } from "@/lib/actions/dens";

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

  const password = generatePassword();
  await prisma.user.create({
    data: {
      username: clean,
      passwordHash: await hashPassword(password),
      role,
      displayName: name,
      email: cleanEmail,
    },
  });

  revalidatePath("/portal/admin/users");

  if (cleanEmail) {
    const { sent } = await sendCredentialEmail(cleanEmail, { username: clean, password, isNewAccount: true });
    if (sent) return { ok: true as const, emailedTo: cleanEmail };
  }
  const credential: CreatedCredential = { username: clean, password };
  return { ok: true as const, credential };
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

  const password = generatePassword();
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(password),
      failedLoginCount: 0,
      lockedUntil: null,
      // Revoke any sessions still signed in with the old password.
      sessionVersion: { increment: 1 },
    },
  });

  revalidatePath("/portal/admin/users");

  if (user.email) {
    const { sent } = await sendCredentialEmail(user.email, {
      username: user.username,
      password,
      isNewAccount: false,
    });
    if (sent) return { ok: true as const, emailedTo: user.email };
  }
  const credential: CreatedCredential = { username: user.username, password };
  return { ok: true as const, credential };
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
