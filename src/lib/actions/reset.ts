"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertMasterAdmin } from "@/lib/authorize";
import { resetConfirmationPhrase } from "@/lib/resetConfirmation";

export type ResetState = { error?: string; deletedCount?: number; scoutingYear?: string };

/**
 * Wipes every scout's roster entry for a single scouting year — cascades to
 * delete their AdvancementRecord, Attendance, DuesPayment, and Parent rows
 * (all @relation onDelete: Cascade off Scout). Dens, the meeting-date
 * calendar (including NO_MEETING cancellations), the adventure list, dues
 * settings, and every login are untouched — but a parent login linked only
 * to scouts in this year loses those contacts, so (matching
 * deleteScoutCascade's pattern) its sessionVersion is bumped too, so an
 * already-issued session can't keep vouching for a now-deleted scout.
 */
export async function resetPackDataAction(_prevState: ResetState, formData: FormData): Promise<ResetState> {
  const session = await getSession();
  if (!session) return { error: "Not authorized." };
  try {
    await assertMasterAdmin(session);
  } catch {
    return { error: "Not authorized." };
  }

  const scoutingYear = String(formData.get("scoutingYear") || "").trim();
  if (!scoutingYear) return { error: "Choose a scouting year." };

  const expected = resetConfirmationPhrase(scoutingYear);
  const confirmation = String(formData.get("confirmation") || "").trim();
  if (confirmation !== expected) {
    return { error: `Type "${expected}" exactly to confirm.` };
  }

  const scoutIds = (await prisma.scout.findMany({ where: { den: { scoutingYear } }, select: { id: true } })).map(
    (s) => s.id
  );
  const linkedParents = await prisma.parent.findMany({
    where: { scoutId: { in: scoutIds }, userId: { not: null } },
    select: { userId: true },
  });
  const linkedUserIds = [...new Set(linkedParents.map((p) => p.userId!))];

  const [{ count }] = await prisma.$transaction([
    prisma.scout.deleteMany({ where: { id: { in: scoutIds } } }),
    ...linkedUserIds.map((userId) =>
      prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } })
    ),
  ]);

  revalidatePath("/portal/admin", "layout");
  revalidatePath("/portal/den", "layout");
  revalidatePath("/portal/roster");
  return { deletedCount: count, scoutingYear };
}
