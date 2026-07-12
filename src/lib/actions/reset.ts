"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertMasterAdmin } from "@/lib/authorize";
import { resetConfirmationPhrase } from "@/lib/resetConfirmation";

export type ResetState = { error?: string; deletedCount?: number; scoutingYear?: string };

/**
 * Wipes every scout's roster entry for a single scouting year — cascades to
 * delete their AdvancementRecord, Attendance, and DuesPayment rows (all
 * @relation onDelete: Cascade off Scout). Dens, the meeting-date calendar
 * (including NO_MEETING cancellations), the adventure list, dues settings,
 * and every login are untouched, so that year starts on a clean roster
 * without losing its structure or affecting any other scouting year.
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

  const { count } = await prisma.scout.deleteMany({ where: { den: { scoutingYear } } });

  revalidatePath("/portal/admin", "layout");
  revalidatePath("/portal/den", "layout");
  revalidatePath("/portal/roster");
  return { deletedCount: count, scoutingYear };
}
