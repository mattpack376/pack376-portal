"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin } from "@/lib/authorize";
import { recordAuditInTransaction, changedFields, auditMoney, auditDate } from "@/lib/audit";
import { MAX_NOTE_LENGTH, dollarsToCents, textField } from "@/lib/formValues";
import { readDateOnlyField, todayDateOnly } from "@/lib/dateOnly";
import {
  PAYMENT_RECORD_STATUS_LABELS,
  isPaymentRecordStatus,
  paymentRecordVersion,
} from "@/lib/paymentRecordView";
import type { PaymentRecordStatus } from "@/generated/prisma/enums";

export type PaymentRecordFormResult = { error?: string };

/** A refusal shown on the form; thrown inside the transaction so nothing it wrote is kept. */
class PaymentRecordInputError extends Error {}

const RECORD_GONE = "That payment record no longer exists. Reload the page.";
const RECORD_CHANGED =
  "Someone else recorded an outcome for this payment after this page loaded. Nothing was saved — reload the page to see it, then make your change again.";

/**
 * Records what became of a kept payment (Admin → Payment Records): refunded
 * (how much, and when), kept by the pack, entered by mistake, not applicable,
 * or back to needing a decision — with a note. Admin only.
 *
 * A refund needs an amount above $0 and no more than was paid, and a date
 * that isn't in the future. Any other outcome clears the refund fields: the
 * form keeps showing the old amount when the status is changed away from
 * Refunded, and refusing that would only make the admin clear it by hand.
 *
 * The row is locked and its fingerprint checked (paymentRecordVersion), so
 * two admins deciding the same record at once can't silently overwrite each
 * other. The audit entry is written in the same transaction: this is a money
 * decision, and an unrecorded one matters more than a failed save.
 */
export async function resolvePaymentRecordAction(formData: FormData): Promise<PaymentRecordFormResult> {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  try {
    const id = textField(formData.get("id"));
    if (!id) throw new PaymentRecordInputError("Missing payment record id.");
    const version = textField(formData.get("version"));

    const status = textField(formData.get("status"));
    if (!isPaymentRecordStatus(status)) throw new PaymentRecordInputError("Choose what happened to this payment.");

    const note = textField(formData.get("note"));
    if (note.length > MAX_NOTE_LENGTH) {
      throw new PaymentRecordInputError(`The note can be at most ${MAX_NOTE_LENGTH} characters.`);
    }
    // Postgres can't store a NUL in text; refuse it here rather than fail the save with a generic error.
    if (note.includes("\u0000")) throw new PaymentRecordInputError("The note can't be saved with an invisible NUL character in it.");

    await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "PaymentRecord" WHERE id = ${id} FOR UPDATE`;
      if (locked.length === 0) throw new PaymentRecordInputError(RECORD_GONE);
      const before = await tx.paymentRecord.findUniqueOrThrow({ where: { id } });
      if (paymentRecordVersion(before) !== version) throw new PaymentRecordInputError(RECORD_CHANGED);

      let refundedCents: number | null = null;
      let refundedOn: Date | null = null;
      if (status === "REFUNDED") {
        ({ refundedCents, refundedOn } = readRefund(formData, before.amountCents));
      }

      const actor = await tx.user.findUnique({ where: { id: session.userId }, select: { displayName: true, username: true } });
      const resolvedByName = actor ? actor.displayName || actor.username : session.displayName;

      await tx.paymentRecord.update({
        where: { id },
        data: {
          status,
          refundedCents,
          refundedOn,
          resolutionNote: note || null,
          resolvedAt: new Date(),
          resolvedByName,
        },
      });

      await recordAuditInTransaction(tx, session, {
        action: "paymentRecord.resolve",
        summary: `${outcomeSummary(status, refundedCents, refundedOn)} — ${auditMoney(before.amountCents)} for ${before.paidFor}`,
        entityType: "PaymentRecord",
        entityId: id,
        details: changedFields({
          Status: [PAYMENT_RECORD_STATUS_LABELS[before.status], PAYMENT_RECORD_STATUS_LABELS[status]],
          "Refunded amount": [
            before.refundedCents === null ? null : auditMoney(before.refundedCents),
            refundedCents === null ? null : auditMoney(refundedCents),
          ],
          "Refund date": [before.refundedOn ? auditDate(before.refundedOn) : null, refundedOn ? auditDate(refundedOn) : null],
          Note: [before.resolutionNote, note || null],
        }),
      });
    });
  } catch (error) {
    if (error instanceof PaymentRecordInputError) return { error: error.message };
    throw error;
  }

  revalidatePath("/portal/admin/payment-records");
  revalidatePath("/portal/admin");
  return {};
}

function readRefund(formData: FormData, paidCents: number): { refundedCents: number; refundedOn: Date } {
  const amountRaw = textField(formData.get("refundedAmount"));
  if (!amountRaw) throw new PaymentRecordInputError("Enter how much was refunded.");
  const refundedCents = dollarsToCents(amountRaw);
  if (refundedCents === null) throw new PaymentRecordInputError("Enter the refund as a dollar amount, like 45 or 45.50.");
  if (refundedCents <= 0) throw new PaymentRecordInputError("The refund has to be more than $0.00.");
  if (refundedCents > paidCents) {
    throw new PaymentRecordInputError(`The refund can't be more than the ${auditMoney(paidCents)} that was paid.`);
  }

  const read = readDateOnlyField(formData.get("refundedOn"), "The refund date");
  if (read.error !== undefined) throw new PaymentRecordInputError(read.error);
  if (!read.date) throw new PaymentRecordInputError("Enter the date it was refunded.");
  if (read.date > todayDateOnly()) throw new PaymentRecordInputError("The refund date can't be in the future.");
  return { refundedCents, refundedOn: read.date };
}

function outcomeSummary(status: PaymentRecordStatus, refundedCents: number | null, refundedOn: Date | null) {
  switch (status) {
    case "REFUNDED":
      return `Marked refunded (${auditMoney(refundedCents)} on ${auditDate(refundedOn)})`;
    case "KEPT_BY_PACK":
      return "Marked kept by the pack";
    case "ENTERED_IN_ERROR":
      return "Marked entered by mistake";
    case "NOT_APPLICABLE":
      return "Marked not applicable";
    case "NEEDS_DECISION":
      return "Put back to needs a decision";
  }
}
