"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertMasterAdmin } from "@/lib/authorize";
import { RESET_CONFIRMATION_PHRASE } from "@/lib/resetConfirmation";

export type ResetState = { error?: string; deletedCount?: number };

/**
 * Wipes every scout's roster entry pack-wide — cascades to delete their
 * AdvancementRecord, Attendance, and DuesPayment rows (all @relation
 * onDelete: Cascade off Scout). Dens, the meeting-date calendar (including
 * NO_MEETING cancellations), the adventure list, dues settings, and every
 * login are untouched, so next season starts on a clean roster without
 * losing the season's structure.
 */
export async function resetPackDataAction(_prevState: ResetState, formData: FormData): Promise<ResetState> {
  const session = await getSession();
  if (!session) return { error: "Not authorized." };
  try {
    await assertMasterAdmin(session);
  } catch {
    return { error: "Not authorized." };
  }

  const confirmation = String(formData.get("confirmation") || "").trim();
  if (confirmation !== RESET_CONFIRMATION_PHRASE) {
    return { error: `Type "${RESET_CONFIRMATION_PHRASE}" exactly to confirm.` };
  }

  const { count } = await prisma.scout.deleteMany({});

  revalidatePath("/portal/admin", "layout");
  revalidatePath("/portal/den", "layout");
  return { deletedCount: count };
}
