"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import { assertAdmin } from "@/lib/authorize";
import { generatePassword } from "@/lib/passwords";
import type { CreatedCredential } from "@/lib/actions/dens";

export async function createAdminAction(username: string, displayName: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authorized." };
  try {
    assertAdmin(session);
  } catch {
    return { ok: false as const, error: "Not authorized." };
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
      role: "ADMIN",
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
