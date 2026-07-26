"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdvancementDenAccess } from "@/lib/authorize";

export async function applyAdventureChangesAction(
  scoutId: string,
  changes: { adventureId: string; completed: boolean }[]
) {
  const session = await getSession();
  if (!session) return { ok: false as const };
  if (changes.length === 0) return { ok: true as const };

  const scout = await prisma.scout.findUnique({ where: { id: scoutId }, select: { denId: true } });
  if (!scout) return { ok: false as const };

  try {
    assertAdvancementDenAccess(session, scout.denId);
  } catch {
    return { ok: false as const };
  }

  await prisma.$transaction(
    changes.map(({ adventureId, completed }) =>
      prisma.advancementRecord.upsert({
        where: { scoutId_adventureId: { scoutId, adventureId } },
        update: { completed, completedDate: completed ? new Date() : null, updatedByUserId: session.userId },
        create: {
          scoutId,
          adventureId,
          completed,
          completedDate: completed ? new Date() : null,
          updatedByUserId: session.userId,
        },
      })
    )
  );

  revalidatePath("/portal/den");
  revalidatePath(`/portal/admin/dens/${scout.denId}`);
  return { ok: true as const };
}
