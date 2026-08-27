"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdvancementDenAccess } from "@/lib/authorize";
import { parseDateOnlyString } from "@/lib/dateOnly";

export type AdventureChange = {
  adventureId: string;
  completed: boolean;
  /** YYYY-MM-DD. Required when completed; ignored (and cleared) when not. */
  completedDate: string | null;
  /** YYYY-MM-DD, or null while the badge still hasn't been presented. */
  awardedDate: string | null;
};

export async function applyAdventureChangesAction(scoutId: string, changes: AdventureChange[]) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authorized." };
  if (changes.length === 0) return { ok: true as const };

  const scout = await prisma.scout.findUnique({ where: { id: scoutId }, select: { denId: true } });
  if (!scout) return { ok: false as const, error: "Scout not found." };

  try {
    assertAdvancementDenAccess(session, scout.denId);
  } catch {
    return { ok: false as const, error: "Not authorized for this den." };
  }

  /*
   * Parse every date before writing anything: a malformed one should fail the
   * whole Apply, not leave half the card saved. Unchecking clears both dates —
   * an adventure that isn't complete can't have been completed or awarded.
   */
  const parsed: { adventureId: string; completed: boolean; completedDate: Date | null; awardedDate: Date | null }[] = [];
  for (const change of changes) {
    if (!change.completed) {
      parsed.push({ adventureId: change.adventureId, completed: false, completedDate: null, awardedDate: null });
      continue;
    }
    let completedDate: Date | null;
    let awardedDate: Date | null;
    try {
      completedDate = parseDateOnlyString(change.completedDate);
      awardedDate = parseDateOnlyString(change.awardedDate);
    } catch {
      return { ok: false as const, error: "That date isn't valid — check the dates and try again." };
    }
    if (!completedDate) {
      return { ok: false as const, error: "A completion date is required for every adventure you check." };
    }
    parsed.push({ adventureId: change.adventureId, completed: true, completedDate, awardedDate });
  }

  await prisma.$transaction(
    parsed.map(({ adventureId, completed, completedDate, awardedDate }) =>
      prisma.advancementRecord.upsert({
        where: { scoutId_adventureId: { scoutId, adventureId } },
        update: { completed, completedDate, awardedDate, updatedByUserId: session.userId },
        create: {
          scoutId,
          adventureId,
          completed,
          completedDate,
          awardedDate,
          updatedByUserId: session.userId,
        },
      })
    )
  );

  revalidatePath("/portal/den");
  revalidatePath(`/portal/admin/dens/${scout.denId}`);
  return { ok: true as const };
}
