"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin } from "@/lib/authorize";

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

  await prisma.household.create({ data: { name: name || null } });

  revalidateHouseholds();
}

export async function renameHouseholdAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const householdId = String(formData.get("householdId") || "");
  const name = String(formData.get("name") || "").trim();
  if (!householdId) throw new Error("Missing household id.");

  await prisma.household.update({ where: { id: householdId }, data: { name: name || null } });

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

  // Members' householdId is just nulled out (onDelete: SetNull) — no scout or
  // login is deleted, only the grouping itself.
  await prisma.household.delete({ where: { id: householdId } });

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

  await prisma.scout.update({ where: { id: scoutId }, data: { householdId } });

  revalidateHouseholds(householdId);
}

export async function removeScoutFromHouseholdAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const scoutId = String(formData.get("scoutId") || "");
  const householdId = String(formData.get("householdId") || "");
  if (!scoutId) throw new Error("Missing scout id.");

  await prisma.scout.update({ where: { id: scoutId }, data: { householdId: null } });

  revalidateHouseholds(householdId);
}

export async function addUserToHouseholdAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const householdId = String(formData.get("householdId") || "");
  const userId = String(formData.get("userId") || "");
  if (!householdId || !userId) throw new Error("Missing household or login.");

  await prisma.user.update({ where: { id: userId }, data: { householdId } });

  revalidateHouseholds(householdId);
}

export async function removeUserFromHouseholdAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const userId = String(formData.get("userId") || "");
  const householdId = String(formData.get("householdId") || "");
  if (!userId) throw new Error("Missing user id.");

  await prisma.user.update({ where: { id: userId }, data: { householdId: null } });

  revalidateHouseholds(householdId);
}
