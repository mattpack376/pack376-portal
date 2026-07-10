"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import { assertAdmin } from "@/lib/authorize";
import { generatePassword } from "@/lib/passwords";
import { isMasterAdminUsername } from "@/lib/masterAdmins";
import type { CreatedCredential } from "@/lib/actions/dens";

export async function createAdminAction(
  username: string,
  displayName: string,
  role: "ADMIN" | "ATTENDANCE_ADMIN" = "ADMIN"
) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authorized." };
  try {
    assertAdmin(session);
  } catch {
    return { ok: false as const, error: "Not authorized." };
  }

  if (role !== "ADMIN" && role !== "ATTENDANCE_ADMIN") {
    return { ok: false as const, error: "Invalid role." };
  }

  const clean = username.trim().toLowerCase();
  const name = displayName.trim();
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
    },
  });

  revalidatePath("/portal/admin/users");
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

  const password = generatePassword();
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null },
  });

  revalidatePath("/portal/admin/users");
  const credential: CreatedCredential = { username: user.username, password };
  return { ok: true as const, credential };
}

/**
 * Changes an account between the two admin-tier roles (full Admin and
 * Attendance Only). Den logins aren't editable here — they're tied to a
 * specific den and managed from that den's page. Master admins can't be
 * changed through the UI at all; see src/lib/masterAdmins.ts.
 */
export async function updateUserRoleAction(userId: string, role: "ADMIN" | "ATTENDANCE_ADMIN") {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authorized." };
  try {
    assertAdmin(session);
  } catch {
    return { ok: false as const, error: "Not authorized." };
  }

  if (role !== "ADMIN" && role !== "ATTENDANCE_ADMIN") {
    return { ok: false as const, error: "Invalid role." };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false as const, error: "User not found." };
  if (isMasterAdminUsername(user.username)) {
    return { ok: false as const, error: "Master admins can't be changed from the admin panel." };
  }
  if (user.role === "DEN") {
    return { ok: false as const, error: "Den logins can't be changed to an admin role here." };
  }

  await prisma.user.update({ where: { id: userId }, data: { role } });

  revalidatePath("/portal/admin/users");
  return { ok: true as const };
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
  return { ok: true as const };
}
