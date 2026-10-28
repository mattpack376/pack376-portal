"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertMasterAdmin } from "@/lib/authorize";
import { resetConfirmationPhrase } from "@/lib/resetConfirmation";
import { recordAudit, auditMoney } from "@/lib/audit";
import { keepPaymentRecords } from "@/lib/paymentRecords";
import { keptPaymentsNote } from "@/lib/scoutDeletion";

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
 *
 * Every dues and event payment those scouts had is copied into Payment
 * Records first, in the same transaction as the delete, so a fresh year never
 * loses track of money a family paid (the page warns with the count and total).
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

  const { count, kept } = await prisma.$transaction(
    async (tx) => {
      const kept = await keepPaymentRecords(
        tx,
        { scoutIds },
        { session, reason: `Season ${scoutingYear} reset (Start a Fresh Year)` },
      );
      const { count } = await tx.scout.deleteMany({ where: { id: { in: scoutIds } } });
      for (const userId of linkedUserIds) {
        await tx.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
      }
      return { count, kept };
    },
    // A whole season is a lot of rows to copy and delete; Prisma's 5-second
    // default would be cutting it close.
    { timeout: 60_000 },
  );

  // The single most destructive action in the portal, so the entry keeps the
  // count and the year even though the scouts themselves are unrecoverable.
  await recordAudit(session, {
    action: "reset.packData",
    summary: `Reset the ${scoutingYear} season — deleted ${count} scout${
      count === 1 ? "" : "s"
    } with their advancement, attendance, dues and parent contacts${keptPaymentsNote(kept)}`,
    entityType: "Scout",
    entityId: null,
    details: [
      { label: "Scouting year", from: scoutingYear, to: "—" },
      { label: "Scouts deleted", from: String(count), to: "—" },
      { label: "Parent logins revoked", from: String(linkedUserIds.length), to: "—" },
      ...(kept.count > 0
        ? [{ label: "Payments kept in Payment Records", from: "—", to: `${kept.count} (${auditMoney(kept.totalCents)})` }]
        : []),
    ],
  });

  revalidatePath("/portal/admin", "layout");
  revalidatePath("/portal/den", "layout");
  revalidatePath("/portal/roster");
  return { deletedCount: count, scoutingYear };
}
