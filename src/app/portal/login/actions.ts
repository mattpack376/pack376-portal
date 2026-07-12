"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSessionCookie, isLockedOut, nextLockout } from "@/lib/auth";

export type LoginState = { error?: string };

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");

  if (!username || !password) {
    return { error: "Enter a username and password." };
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    return { error: "Invalid username or password." };
  }

  if (isLockedOut(user.lockedUntil)) {
    return { error: "Too many failed attempts. Try again in about 15 minutes." };
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const { failedLoginCount, lockedUntil } = nextLockout(user.failedLoginCount);
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount, lockedUntil } });
    return lockedUntil
      ? { error: "Too many failed attempts. Try again in about 15 minutes." }
      : { error: "Invalid username or password." };
  }

  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  const denAssignments = await prisma.denAssignment.findMany({
    where: { userId: user.id },
    select: { denId: true },
  });
  await createSessionCookie({
    userId: user.id,
    role: user.role,
    denIds: denAssignments.map((a) => a.denId),
    displayName: user.displayName,
  });

  redirect("/portal");
}
