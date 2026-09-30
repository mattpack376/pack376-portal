"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin } from "@/lib/authorize";
import { recordAudit } from "@/lib/audit";
import { sendReceiptEmail } from "@/lib/email";
import { buildReceiptPdf } from "@/lib/receiptPdf";
import type { SessionPayload } from "@/lib/session";
import {
  RECEIPT_KIND_INFO,
  RECEIPT_RECORDS_EMAIL,
  formatReceiptMoney,
  receiptDataFromRecord,
  receiptFilename,
  receiptRecordMatches,
  validateReceiptInput,
  type ReceiptData,
  type ReceiptInput,
} from "@/lib/receipts";

export type GenerateReceiptResult =
  | { ok: true; id: string; filename: string; pdfBase64: string }
  | { ok: false; error: string };

export type EmailReceiptResult =
  | { ok: true; id: string; sentTo: string }
  | { ok: false; error: string };

async function requireAdmin() {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);
  return session;
}

function auditSummary(verb: string, data: ReceiptData, suffix = "") {
  const label = RECEIPT_KIND_INFO[data.kind].label.toLowerCase();
  return `${verb} a ${label} receipt for ${data.receivedFrom} (${formatReceiptMoney(data.amountCents)})${suffix}`;
}

/**
 * The stored row this receipt should live in. When the caller names the row
 * it just created (Download, then Email, of the same form) and nothing has
 * changed, that row is reused so one receipt is one history entry; anything
 * else, including a row that no longer matches, is a new receipt.
 */
async function findReusableReceipt(existingId: unknown, data: ReceiptData) {
  if (typeof existingId !== "string" || !existingId) return null;
  const record = await prisma.receipt.findUnique({ where: { id: existingId } });
  return record && receiptRecordMatches(record, data) ? record : null;
}

function recordColumns(data: ReceiptData) {
  return {
    kind: data.kind,
    receivedFrom: data.receivedFrom,
    scoutName: data.scoutName,
    purpose: data.purpose,
    season: data.season,
    amountCents: data.amountCents,
    receiptDate: new Date(`${data.date}T00:00:00.000Z`),
    method: data.method,
    status: data.status,
    issuedByName: data.issuedByName,
    issuedByTitle: data.issuedByTitle,
  };
}

async function createReceiptRecord(session: SessionPayload, data: ReceiptData, createdAt: Date, emailedTo?: string) {
  return prisma.receipt.create({
    data: {
      ...recordColumns(data),
      createdAt,
      createdByUserId: session.userId,
      ...(emailedTo ? { emailedTo, emailedAt: createdAt } : {}),
    },
  });
}

export async function generateReceiptAction(input: ReceiptInput, existingId?: string): Promise<GenerateReceiptResult> {
  const session = await requireAdmin();
  const result = validateReceiptInput(input, { requireEmail: false });
  if (!result.ok) return result;

  const reused = await findReusableReceipt(existingId, result.data);
  const record = reused ?? (await createReceiptRecord(session, result.data, new Date()));
  const pdf = await buildReceiptPdf(result.data, record.createdAt);

  if (!reused) {
    await recordAudit(session, {
      action: "receipt.generate",
      summary: auditSummary("Generated", result.data),
      entityType: "Receipt",
      entityId: record.id,
    });
    revalidatePath("/portal/admin/receipts");
  }

  return {
    ok: true,
    id: record.id,
    filename: receiptFilename(result.data),
    pdfBase64: Buffer.from(pdf).toString("base64"),
  };
}

export async function emailReceiptAction(input: ReceiptInput, existingId?: string): Promise<EmailReceiptResult> {
  const session = await requireAdmin();
  const result = validateReceiptInput(input, { requireEmail: true });
  if (!result.ok) return result;

  const reused = await findReusableReceipt(existingId, result.data);
  const stampedAt = reused?.createdAt ?? new Date();
  const pdf = await buildReceiptPdf(result.data, stampedAt);

  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { email: true } });
  const { sent, configured } = await sendReceiptEmail(result.emailTo, {
    isDonation: result.data.kind === "DONATION",
    receivedFrom: result.data.receivedFrom,
    amountLabel: formatReceiptMoney(result.data.amountCents),
    filename: receiptFilename(result.data),
    pdf,
    bcc: RECEIPT_RECORDS_EMAIL,
    replyTo: me?.email ?? undefined,
  });

  if (!configured) {
    return { ok: false, error: "Email isn't set up on the server yet. Use Download PDF and send it yourself." };
  }
  if (!sent) {
    return { ok: false, error: "The email didn't go through. Check the address, or use Download PDF and send it yourself." };
  }

  // Saved only once it has gone out, so history never lists an email that failed.
  const record = reused
    ? await prisma.receipt.update({ where: { id: reused.id }, data: { emailedTo: result.emailTo, emailedAt: new Date() } })
    : await createReceiptRecord(session, result.data, stampedAt, result.emailTo);

  await recordAudit(session, {
    action: "receipt.email",
    summary: auditSummary("Emailed", result.data, ` to ${result.emailTo}`),
    entityType: "Receipt",
    entityId: record.id,
  });
  revalidatePath("/portal/admin/receipts");

  return { ok: true, id: record.id, sentTo: result.emailTo };
}

/** Rebuilds a saved receipt's PDF exactly as it was issued. */
export async function downloadSavedReceiptAction(id: string): Promise<GenerateReceiptResult> {
  await requireAdmin();
  const record = typeof id === "string" && id ? await prisma.receipt.findUnique({ where: { id } }) : null;
  if (!record) return { ok: false, error: "That receipt no longer exists." };

  const data = receiptDataFromRecord(record);
  const pdf = await buildReceiptPdf(data, record.createdAt);
  return { ok: true, id: record.id, filename: receiptFilename(data), pdfBase64: Buffer.from(pdf).toString("base64") };
}

export type DeleteReceiptResult = { ok: true } | { ok: false; error: string };

/**
 * Removes a receipt from the history, for one entered by mistake. The row is
 * gone for good, so the audit entry records everything it said, and an email
 * that already went out is not unsent.
 */
export async function deleteReceiptAction(id: string): Promise<DeleteReceiptResult> {
  const session = await requireAdmin();
  const record = typeof id === "string" && id ? await prisma.receipt.findUnique({ where: { id } }) : null;
  if (!record) return { ok: false, error: "That receipt was already deleted." };

  await prisma.receipt.delete({ where: { id: record.id } });

  const data = receiptDataFromRecord(record);
  await recordAudit(session, {
    action: "receipt.delete",
    summary: auditSummary("Deleted", data, ` dated ${data.date}${record.emailedTo ? `, which had been emailed to ${record.emailedTo}` : ""}`),
    entityType: "Receipt",
    entityId: record.id,
  });
  revalidatePath("/portal/admin/receipts");

  return { ok: true };
}
