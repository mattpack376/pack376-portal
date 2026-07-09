"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertDenAccess } from "@/lib/authorize";

export async function toggleAdventureAction(scoutId: string, adventureId: string, completed: boolean) {
  const session = await getSession();
  if (!session) return { ok: false as const };

  const scout = await prisma.scout.findUnique({ where: { id: scoutId }, select: { denId: true } });
  if (!scout) return { ok: false as const };

  try {
    assertDenAccess(session, scout.denId);
  } catch {
    return { ok: false as const };
  }

  await prisma.advancementRecord.upsert({
    where: { scoutId_adventureId: { scoutId, adventureId } },
    update: { completed, completedDate: completed ? new Date() : null },
    create: { scoutId, adventureId, completed, completedDate: completed ? new Date() : null },
  });

  revalidatePath("/portal/den");
  revalidatePath(`/portal/admin/dens/${scout.denId}`);
  return { ok: true as const };
}
