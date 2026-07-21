"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { checkRateLimit } from "@vercel/firewall";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSessionCookie, isLockedOut, nextLockout } from "@/lib/auth";

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
