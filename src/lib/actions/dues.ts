"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin } from "@/lib/authorize";
import { recordAudit, changedFields, auditMoney, auditDate } from "@/lib/audit";

function dollarsToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** "Tommy Smith" for audit summaries, or the raw id if the scout is already gone. */
async function scoutName(scoutId: string) {
  const scout = await prisma.scout.findUnique({
    where: { id: scoutId },
    select: { firstName: true, lastName: true, denId: true },
  });
  return {
    name: scout ? `${scout.firstName} ${scout.lastName}` : scoutId,
    denId: scout?.denId ?? null,
  };
}

export async function setDuesAmountAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const scoutingYear = String(formData.get("scoutingYear") || "").trim();
  const amountCents = dollarsToCents(String(formData.get("amount") || ""));
  if (!scoutingYear || amountCents === null) throw new Error("A valid season fee amount is required.");

  const before = await prisma.duesSettings.findUnique({ where: { scoutingYear }, select: { amountCents: true } });

  await prisma.duesSettings.upsert({
    where: { scoutingYear },
    create: { scoutingYear, amountCents },
    update: { amountCents },
  });

  await recordAudit(session, {
    action: "dues.settings.set",
    summary: `Set the ${scoutingYear} season fee to ${auditMoney(amountCents)}`,
    entityType: "DuesSettings",
    entityId: scoutingYear,
    details: changedFields({
      "Season fee": [before ? auditMoney(before.amountCents) : null, auditMoney(amountCents)],
    }),
  });

  revalidatePath("/portal/admin/dues");
}

export async function setScoutDuesOverrideAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const scoutId = String(formData.get("scoutId") || "");
  if (!scoutId) throw new Error("Missing scout id.");
  const amountCents = dollarsToCents(String(formData.get("amount") || ""));

  const before = await prisma.scout.findUnique({ where: { id: scoutId }, select: { duesOverrideCents: true } });

  await prisma.scout.update({
    where: { id: scoutId },
    data: { duesOverrideCents: amountCents },
  });

  const { name, denId } = await scoutName(scoutId);
  await recordAudit(session, {
    action: "dues.override.set",
    summary:
      amountCents === null
        ? `Removed the dues override for ${name} — back to the standard season fee`
        : `Set ${name}'s dues to ${auditMoney(amountCents)} (override)`,
    entityType: "Scout",
    entityId: scoutId,
    denId,
    details: changedFields({
      "Dues override": [
        before?.duesOverrideCents === null || before?.duesOverrideCents === undefined
          ? null
          : auditMoney(before.duesOverrideCents),
        amountCents === null ? null : auditMoney(amountCents),
      ],
    }),
  });

  revalidatePath(`/portal/admin/dues/${scoutId}`);
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

  const payment = await prisma.duesPayment.create({
    data: { scoutId, amountCents, paidOn, note, recordedByUserId: session.userId },
  });

  const { name, denId } = await scoutName(scoutId);
  await recordAudit(session, {
    action: "dues.payment.add",
    summary: `Recorded a ${auditMoney(amountCents)} dues payment for ${name}`,
    entityType: "DuesPayment",
    entityId: payment.id,
    denId,
    details: [
      { label: "Amount", from: "—", to: auditMoney(amountCents) },
      { label: "Paid on", from: "—", to: auditDate(paidOn) },
      ...(note ? [{ label: "Note", from: "—", to: note }] : []),
    ],
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

  // Read before deleting — once it's gone the amount and date are only
  // recoverable from this entry.
  const payment = await prisma.duesPayment.findUnique({
    where: { id: paymentId },
    select: { amountCents: true, paidOn: true, note: true },
  });

  await prisma.duesPayment.delete({ where: { id: paymentId } });

  const { name, denId } = await scoutName(scoutId);
  await recordAudit(session, {
    action: "dues.payment.delete",
    summary: payment
      ? `Deleted a ${auditMoney(payment.amountCents)} dues payment for ${name}`
      : `Deleted a dues payment for ${name}`,
    entityType: "DuesPayment",
    entityId: paymentId,
    denId,
    details: payment
      ? [
          { label: "Amount", from: auditMoney(payment.amountCents), to: "—" },
          { label: "Paid on", from: auditDate(payment.paidOn), to: "—" },
          ...(payment.note ? [{ label: "Note", from: payment.note, to: "—" }] : []),
        ]
      : null,
  });

  revalidatePath(`/portal/admin/dues/${scoutId}`);
  revalidatePath("/portal/admin/dues");
}
