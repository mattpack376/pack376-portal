"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdvancementDenAccess } from "@/lib/authorize";
import { parseDateOnlyString } from "@/lib/dateOnly";
import { recordAudit, auditDate, EMPTY, type AuditDetail } from "@/lib/audit";

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

  const scout = await prisma.scout.findUnique({
    where: { id: scoutId },
    select: { denId: true, firstName: true, lastName: true },
  });
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

  // Read the current state before writing so the audit entry can show what
  // each adventure actually went from, and so an Apply that re-submits
  // untouched checkboxes doesn't log them as changes.
  const adventureIds = parsed.map((p) => p.adventureId);
  const [adventures, existing] = await Promise.all([
    prisma.adventure.findMany({ where: { id: { in: adventureIds } }, select: { id: true, name: true } }),
    prisma.advancementRecord.findMany({
      where: { scoutId, adventureId: { in: adventureIds } },
      select: { adventureId: true, completed: true, completedDate: true, awardedDate: true },
    }),
  ]);
  const adventureName = new Map(adventures.map((a) => [a.id, a.name]));
  const priorByAdventure = new Map(existing.map((r) => [r.adventureId, r]));

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

  const scoutName = `${scout.firstName} ${scout.lastName}`;
  const details: AuditDetail[] = [];
  for (const change of parsed) {
    const prior = priorByAdventure.get(change.adventureId);
    const from = describeAdventureState(prior?.completed ?? false, prior?.completedDate ?? null, prior?.awardedDate ?? null);
    const to = describeAdventureState(change.completed, change.completedDate, change.awardedDate);
    if (from === to) continue;
    details.push({ label: adventureName.get(change.adventureId) ?? change.adventureId, from, to });
  }

  if (details.length > 0) {
    const summary =
      details.length === 1
        ? `${details[0].to === EMPTY ? "Cleared" : "Updated"} “${details[0].label}” for ${scoutName}`
        : `Updated ${details.length} adventures for ${scoutName}`;
    await recordAudit(session, {
      action: "advancement.update",
      summary,
      entityType: "Scout",
      entityId: scoutId,
      denId: scout.denId,
      details,
    });
  }

  revalidatePath("/portal/den");
  revalidatePath(`/portal/admin/dens/${scout.denId}`);
  return { ok: true as const };
}

/** One adventure's state as a single audit string: "Complete Sep 10, 2026 · awarded Oct 1, 2026". */
function describeAdventureState(completed: boolean, completedDate: Date | null, awardedDate: Date | null): string {
  if (!completed) return EMPTY;
  const parts = [`Complete ${auditDate(completedDate)}`];
  if (awardedDate) parts.push(`awarded ${auditDate(awardedDate)}`);
  return parts.join(" · ");
}
