"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin } from "@/lib/authorize";
import { deleteScoutCascade } from "@/lib/scoutDeletion";

/**
 * Full scout edit from the admin Users → Scouts screen — name, den, and the
 * two fields that screen alone collects (scouterId, registrationExpiresOn).
 * The den roster's quick add/rename forms stay separate and never touch
 * those two fields, so adding a scout from a den still only asks for a name.
 */
export async function updateScoutAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const scoutId = String(formData.get("scoutId") || "");
  const firstName = String(formData.get("firstName") || "").trim();
  const lastName = String(formData.get("lastName") || "").trim();
  const denId = String(formData.get("denId") || "");
  const scouterId = String(formData.get("scouterId") || "").trim();
  const registrationExpiresOnRaw = String(formData.get("registrationExpiresOn") || "").trim();
  if (!scoutId || !firstName || !lastName || !denId) {
    throw new Error("First name, last name, and den are required.");
  }

  const registrationExpiresOn = registrationExpiresOnRaw
    ? new Date(`${registrationExpiresOnRaw}T00:00:00.000Z`)
    : null;

  const previous = await prisma.scout.findUnique({ where: { id: scoutId }, select: { denId: true } });
  if (!previous) throw new Error("Scout not found.");

  await prisma.scout.update({
    where: { id: scoutId },
    data: {
      firstName,
      lastName,
      denId,
      scouterId: scouterId || null,
      registrationExpiresOn,
    },
  });

  revalidatePath("/portal/admin/users/scouts");
  revalidatePath(`/portal/admin/users/scouts/${scoutId}`);
  revalidatePath(`/portal/admin/dens/${denId}`);
  if (previous.denId !== denId) revalidatePath(`/portal/admin/dens/${previous.denId}`);
  revalidatePath("/portal/roster");
}

export async function deleteScoutAction(scoutId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authorized." };
  try {
    assertAdmin(session);
  } catch {
    return { ok: false as const, error: "Not authorized." };
  }

  const scout = await prisma.scout.findUnique({ where: { id: scoutId }, select: { denId: true } });
  if (!scout) return { ok: false as const, error: "Scout not found." };

  await deleteScoutCascade(scoutId);

  revalidatePath(`/portal/admin/dens/${scout.denId}`);
  revalidatePath("/portal/admin/users/scouts");
  revalidatePath("/portal/roster");
  return { ok: true as const };
}
