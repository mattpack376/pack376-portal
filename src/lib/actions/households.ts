"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin } from "@/lib/authorize";
import { recordAudit, changedFields } from "@/lib/audit";

/** A household's name for audit text — they're optionally named, hence the fallback. */
async function householdLabel(householdId: string) {
  if (!householdId) return "a household";
  const household = await prisma.household.findUnique({ where: { id: householdId }, select: { name: true } });
  return household?.name?.trim() || "an unnamed household";
}

function revalidateHouseholds(householdId?: string) {
  revalidatePath("/portal/admin/users/households");
  if (householdId) revalidatePath(`/portal/admin/users/households/${householdId}`);
  revalidatePath("/portal/admin/users/scouts");
  revalidatePath("/portal/admin/users");
  revalidatePath("/portal/admin/users/parents");
  revalidatePath("/portal/roster/parents");
}

export async function createHouseholdAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const name = String(formData.get("name") || "").trim();

  const household = await prisma.household.create({ data: { name: name || null } });

  await recordAudit(session, {
    action: "household.create",
    summary: `Created the household “${name || "(unnamed)"}”`,
    entityType: "Household",
    entityId: household.id,
  });

  revalidateHouseholds();
}

export async function renameHouseholdAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const householdId = String(formData.get("householdId") || "");
  const name = String(formData.get("name") || "").trim();
  if (!householdId) throw new Error("Missing household id.");

  const before = await prisma.household.findUnique({ where: { id: householdId }, select: { name: true } });

  await prisma.household.update({ where: { id: householdId }, data: { name: name || null } });

  await recordAudit(session, {
    action: "household.rename",
    summary: `Renamed the household “${before?.name || "(unnamed)"}” to “${name || "(unnamed)"}”`,
    entityType: "Household",
    entityId: householdId,
    details: changedFields({ Name: [before?.name, name || null] }),
  });

  revalidateHouseholds(householdId);
}

export async function deleteHouseholdAction(householdId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authorized." };
  try {
    assertAdmin(session);
  } catch {
    return { ok: false as const, error: "Not authorized." };
  }

  const household = await prisma.household.findUnique({
    where: { id: householdId },
    select: { name: true, _count: { select: { scouts: true, users: true } } },
  });

  // Members' householdId is just nulled out (onDelete: SetNull) — no scout or
  // login is deleted, only the grouping itself.
  await prisma.household.delete({ where: { id: householdId } });

  await recordAudit(session, {
    action: "household.delete",
    summary: `Deleted the household “${household?.name || "(unnamed)"}” — ${
      household ? household._count.scouts + household._count.users : 0
    } member(s) were ungrouped, none deleted`,
    entityType: "Household",
    entityId: householdId,
  });

  revalidateHouseholds();
  return { ok: true as const };
}

export async function addScoutToHouseholdAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const householdId = String(formData.get("householdId") || "");
  const scoutId = String(formData.get("scoutId") || "");
  if (!householdId || !scoutId) throw new Error("Missing household or scout.");

  const scout = await prisma.scout.update({ where: { id: scoutId }, data: { householdId } });

  await recordAudit(session, {
    action: "household.addScout",
    summary: `Added scout ${scout.firstName} ${scout.lastName} to ${await householdLabel(householdId)}`,
    entityType: "Household",
    entityId: householdId,
    denId: scout.denId,
  });

  revalidateHouseholds(householdId);
}

export async function removeScoutFromHouseholdAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const scoutId = String(formData.get("scoutId") || "");
  const householdId = String(formData.get("householdId") || "");
  if (!scoutId) throw new Error("Missing scout id.");

  const label = await householdLabel(householdId);
  const scout = await prisma.scout.update({ where: { id: scoutId }, data: { householdId: null } });

  await recordAudit(session, {
    action: "household.removeScout",
    summary: `Removed scout ${scout.firstName} ${scout.lastName} from ${label}`,
    entityType: "Household",
    entityId: householdId || null,
    denId: scout.denId,
  });

  revalidateHouseholds(householdId);
}

export async function addUserToHouseholdAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const householdId = String(formData.get("householdId") || "");
  const userId = String(formData.get("userId") || "");
  if (!householdId || !userId) throw new Error("Missing household or login.");

  const user = await prisma.user.update({ where: { id: userId }, data: { householdId } });

  await recordAudit(session, {
    action: "household.addUser",
    summary: `Added the login “${user.username}” (${user.displayName}) to ${await householdLabel(householdId)}`,
    entityType: "Household",
    entityId: householdId,
  });

  revalidateHouseholds(householdId);
}

export async function removeUserFromHouseholdAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const userId = String(formData.get("userId") || "");
  const householdId = String(formData.get("householdId") || "");
  if (!userId) throw new Error("Missing user id.");

  const label = await householdLabel(householdId);
  const user = await prisma.user.update({ where: { id: userId }, data: { householdId: null } });

  await recordAudit(session, {
    action: "household.removeUser",
    summary: `Removed the login “${user.username}” (${user.displayName}) from ${label}`,
    entityType: "Household",
    entityId: householdId || null,
  });

  revalidateHouseholds(householdId);
}
