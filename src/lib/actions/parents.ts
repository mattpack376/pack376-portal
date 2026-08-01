"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import { assertAdmin } from "@/lib/authorize";
import { generatePassword } from "@/lib/passwords";
import { issueInviteToken } from "@/lib/resetTokens";
import { getAppBaseUrl } from "@/lib/appUrl";
import { sendAccountLinkEmail } from "@/lib/email";
import type { CreatedInvite } from "@/lib/actions/dens";

export async function addParentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const scoutId = String(formData.get("scoutId") || "");
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  if (!scoutId || !name) throw new Error("A parent name is required.");

  await prisma.parent.create({
    data: { scoutId, name, email: email || null, phone: phone || null },
  });

  revalidatePath("/portal/roster/parents");
}

export async function updateParentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const parentId = String(formData.get("parentId") || "");
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  if (!parentId || !name) throw new Error("A parent name is required.");

  await prisma.parent.update({
    where: { id: parentId },
    data: { name, email: email || null, phone: phone || null },
  });

  revalidatePath("/portal/roster/parents");
}

export async function removeParentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const parentId = String(formData.get("parentId") || "");
  if (!parentId) throw new Error("Missing parent id.");

  const parent = await prisma.parent.findUnique({ where: { id: parentId }, select: { userId: true } });

  // scoutIds is baked into the parent's session JWT at login time and lives
  // for up to 45 days; deleting the Parent row alone leaves any already-issued
  // session still vouching for that scout. Bumping sessionVersion invalidates
  // it immediately, forcing a fresh login that recomputes scoutIds from the
  // remaining relationships (siblings share one login, so other scouts on the
  // same account stay accessible after the re-login).
  await prisma.$transaction([
    prisma.parent.delete({ where: { id: parentId } }),
    ...(parent?.userId
      ? [prisma.user.update({ where: { id: parent.userId }, data: { sessionVersion: { increment: 1 } } })]
      : []),
  ]);

  revalidatePath("/portal/roster/parents");
}

/**
 * Invites a parent contact to the Parent Portal. Uses their email as the
 * login username — if a PARENT account already exists for that email (a
 * sibling's contact row invited earlier), this just links the new contact to
 * it instead of creating a second account, so one login covers every scout
 * in the family.
 */
export async function inviteParentPortalAction(parentId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authorized." };
  try {
    assertAdmin(session);
  } catch {
    return { ok: false as const, error: "Not authorized." };
  }

  const parent = await prisma.parent.findUnique({ where: { id: parentId } });
  if (!parent) return { ok: false as const, error: "Parent contact not found." };
  if (parent.userId) return { ok: false as const, error: "This parent already has a portal account." };

  const cleanEmail = parent.email?.trim().toLowerCase();
  if (!cleanEmail) {
    return { ok: false as const, error: "Add an email address for this parent before inviting them." };
  }

  const existing = await prisma.user.findUnique({ where: { username: cleanEmail } });
  if (existing) {
    if (existing.role !== "PARENT") {
      return { ok: false as const, error: "That email is already in use by a different portal account." };
    }
    await prisma.parent.update({ where: { id: parentId }, data: { userId: existing.id } });
    revalidatePath("/portal/roster/parents");
    return { ok: true as const, linkedExisting: true };
  }

  // No password is ever generated server-side for anyone to see — the account
  // starts with a random, immediately-discarded hash, and the parent sets
  // their own password via a one-time invite link.
  const user = await prisma.user.create({
    data: {
      username: cleanEmail,
      passwordHash: await hashPassword(generatePassword()),
      role: "PARENT",
      displayName: parent.name,
      email: cleanEmail,
    },
  });
  await prisma.parent.update({ where: { id: parentId }, data: { userId: user.id } });

  revalidatePath("/portal/roster/parents");

  const token = await issueInviteToken(user.id);
  const url = `${getAppBaseUrl()}/portal/reset/${token}`;

  const { sent } = await sendAccountLinkEmail(cleanEmail, { username: cleanEmail, url, isNewAccount: true });
  if (sent) return { ok: true as const, emailedTo: cleanEmail };
  const invite: CreatedInvite = { username: cleanEmail, url };
  return { ok: true as const, invite };
}

/**
 * Detaches a Parent Portal login from one specific scout, without touching
 * the account itself or its access to any other scouts (siblings can share
 * one login). The Parent contact row (name/email/phone) stays on that
 * scout's roster — only portal visibility into that scout is revoked.
 */
export async function unlinkParentScoutAction(parentId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authorized." };
  try {
    assertAdmin(session);
  } catch {
    return { ok: false as const, error: "Not authorized." };
  }

  const parent = await prisma.parent.findUnique({ where: { id: parentId } });
  if (!parent) return { ok: false as const, error: "Parent contact not found." };
  if (!parent.userId) return { ok: false as const, error: "This contact isn't linked to a portal account." };

  await prisma.$transaction([
    prisma.parent.update({ where: { id: parentId }, data: { userId: null } }),
    // Bump so an already-issued session (scoutIds are baked into the JWT) stops
    // vouching for the unlinked scout until the user logs in again.
    prisma.user.update({ where: { id: parent.userId }, data: { sessionVersion: { increment: 1 } } }),
  ]);

  revalidatePath("/portal/admin/users/parents");
  revalidatePath(`/portal/admin/users/parents/${parent.userId}`);
  revalidatePath("/portal/roster/parents");
  return { ok: true as const };
}

/**
 * Grants an existing Parent Portal login access to an additional scout —
 * e.g. a second child in the pack who doesn't yet have a contact row tied to
 * this account. Creates a new Parent contact (copying the account's current
 * name/email) rather than moving an existing one, since a scout's existing
 * contact rows may belong to a different guardian entirely.
 */
export async function attachParentToScoutAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const userId = String(formData.get("userId") || "");
  const scoutId = String(formData.get("scoutId") || "");
  if (!userId || !scoutId) throw new Error("Missing user or scout.");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== "PARENT") throw new Error("Parent account not found.");

  const existing = await prisma.parent.findFirst({ where: { userId, scoutId } });
  if (existing) throw new Error("This account is already attached to that scout.");

  await prisma.parent.create({
    data: { scoutId, userId, name: user.displayName, email: user.email },
  });

  revalidatePath(`/portal/admin/users/parents/${userId}`);
  revalidatePath("/portal/admin/users/parents");
  revalidatePath("/portal/roster/parents");
}

/** Deletes the linked portal account — revokes it for every scout it's tied to (siblings share one login). */
export async function revokeParentPortalAction(parentId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authorized." };
  try {
    assertAdmin(session);
  } catch {
    return { ok: false as const, error: "Not authorized." };
  }

  const parent = await prisma.parent.findUnique({ where: { id: parentId } });
  if (!parent) return { ok: false as const, error: "Parent contact not found." };
  if (!parent.userId) return { ok: false as const, error: "This parent doesn't have a portal account." };

  await prisma.user.delete({ where: { id: parent.userId } });

  revalidatePath("/portal/roster/parents");
  return { ok: true as const };
}
