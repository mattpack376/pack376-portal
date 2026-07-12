"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin } from "@/lib/authorize";

function dollarsToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export async function setDuesAmountAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const scoutingYear = String(formData.get("scoutingYear") || "").trim();
  const amountCents = dollarsToCents(String(formData.get("amount") || ""));
  if (!scoutingYear || amountCents === null) throw new Error("A valid season fee amount is required.");

  await prisma.duesSettings.upsert({
    where: { scoutingYear },
    create: { scoutingYear, amountCents },
    update: { amountCents },
  });

  revalidatePath("/portal/admin/dues");
}

export async function addDuesPaymentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const scoutId = String(formData.get("scoutId") || "");
  const amountCents = dollarsToCents(String(formData.get("amount") || ""));
  const paidOnRaw = String(formData.get("paidOn") || "").trim();
  const note = String(formData.get("note") || "").trim() || null;
  if (!scoutId || amountCents === null || amountCents === 0) {
    throw new Error("A valid payment amount is required.");
  }

  const paidOn = paidOnRaw ? new Date(paidOnRaw) : new Date();
  if (Number.isNaN(paidOn.getTime())) throw new Error("Invalid payment date.");

  await prisma.duesPayment.create({
    data: { scoutId, amountCents, paidOn, note, recordedByUserId: session.userId },
  });

  revalidatePath(`/portal/admin/dues/${scoutId}`);
  revalidatePath("/portal/admin/dues");
}

export async function deleteDuesPaymentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const paymentId = String(formData.get("paymentId") || "");
  const scoutId = String(formData.get("scoutId") || "");
  if (!paymentId) throw new Error("Missing payment id.");

  await prisma.duesPayment.delete({ where: { id: paymentId } });

  revalidatePath(`/portal/admin/dues/${scoutId}`);
  revalidatePath("/portal/admin/dues");
}
