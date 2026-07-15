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

  await prisma.parent.delete({ where: { id: parentId } });

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
