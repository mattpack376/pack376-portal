"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin } from "@/lib/authorize";
import { recordAudit, recordAuditInTransaction } from "@/lib/audit";
import { MAX_EMAIL_ERROR_LENGTH, isEmailConfigured, sendReceiptEmail } from "@/lib/email";
import { RECEIPT_TEMPLATE_VERSION, buildReceiptPdf, receiptPdfSha256 } from "@/lib/receiptPdf";
import type { SessionPayload } from "@/lib/session";
import {
  EMAIL_ATTEMPT_STALE_MS,
  RECEIPT_KIND_INFO,
  RECEIPT_RECORDS_EMAIL,
  formatReceiptMoney,
  isReceiptRequestKey,
  isValidReceiptEmail,
  receiptDataFromRecord,
  receiptFilename,
  sameReceiptData,
  validateReceiptInput,
  type ReceiptData,
  type ReceiptInput,
} from "@/lib/receipts";

export type GenerateReceiptResult =
  | {
      ok: true;
      id: string;
      filename: string;
      pdfBase64: string;
      /** True for a receipt saved before issued PDFs were kept: this one was rebuilt from its saved details. */
      rebuilt: boolean;
    }
  | { ok: false; error: string };

export type EmailReceiptResult =
  | {
      ok: true;
      id: string;
      sentTo: string;
      /** This exact request had already sent it, so nothing was sent again. */
      alreadySent?: boolean;
    }
  | { ok: false; error: string };

const RECEIPTS_PATH = "/portal/admin/receipts";
const TX = { timeout: 15000, maxWait: 10000 };

const RELOAD = "This page is out of date. Reload it and try again.";
const NOT_CONFIGURED = "Email isn't set up on the server yet. Use Download PDF and send it yourself.";

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

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/** The printed fields of a receipt plus its stored PDF, if it has one — everything but the email columns. */
const ISSUED_SELECT = {
  id: true,
  createdAt: true,
  kind: true,
  receivedFrom: true,
  scoutName: true,
  purpose: true,
  season: true,
  amountCents: true,
  receiptDate: true,
  method: true,
  status: true,
  issuedByName: true,
  issuedByTitle: true,
  document: { select: { pdf: true, sha256: true } },
} as const;

type IssuedReceipt = { id: string; data: ReceiptData; pdf: Uint8Array; rebuilt: boolean };

const DAMAGED =
  "The saved copy of this receipt failed its integrity check, so it wasn't used. Nothing was sent. Let the site's admin know.";

/**
 * A saved receipt's PDF: the stored file exactly as it was issued, or — for
 * one saved before files were kept — rebuilt from its saved details with its
 * original "generated" time, and marked `rebuilt`. A stored file that no
 * longer matches its checksum is never served or sent.
 */
async function issuedReceipt(
  where: { id: string } | { idempotencyKey: string }
): Promise<{ ok: true; receipt: IssuedReceipt } | { ok: false; error: string } | null> {
  const record = await prisma.receipt.findUnique({ where, select: ISSUED_SELECT });
  if (!record) return null;
  const data = receiptDataFromRecord(record);
  if (record.document) {
    const pdf = new Uint8Array(record.document.pdf);
    if (receiptPdfSha256(pdf) !== record.document.sha256) {
      console.error(`Stored receipt PDF ${record.id} doesn't match its checksum.`);
      return { ok: false, error: DAMAGED };
    }
    return { ok: true, receipt: { id: record.id, data, pdf, rebuilt: false } };
  }
  return { ok: true, receipt: { id: record.id, data, pdf: await buildReceiptPdf(data, record.createdAt), rebuilt: true } };
}

/**
 * The receipt this form submission is for: the one an earlier try with the
 * same key already saved, or a new one. A new receipt's PDF is drawn first
 * (no transaction open while it builds), then the row, its PDF and the audit
 * entry are written together. Two tries with one key at once can't both
 * save: the unique key lets one insert win, and the other reads that row.
 */
async function saveReceipt(
  session: SessionPayload,
  data: ReceiptData,
  key: string
): Promise<{ ok: true; receipt: IssuedReceipt } | { ok: false; error: string }> {
  const reuse = async () => {
    const existing = await issuedReceipt({ idempotencyKey: key });
    if (!existing || !existing.ok) return existing;
    // The form starts a new key whenever a printed field changes, so a key
    // arriving with different details is a stale or tampered request.
    if (!sameReceiptData(existing.receipt.data, data)) return { ok: false as const, error: RELOAD };
    return existing;
  };

  const earlier = await reuse();
  if (earlier) return earlier;

  const createdAt = new Date();
  const pdf = await buildReceiptPdf(data, createdAt);
  try {
    const id = await prisma.$transaction(async (tx) => {
      const row = await tx.receipt.create({
        data: {
          ...recordColumns(data),
          createdAt,
          createdByUserId: session.userId,
          idempotencyKey: key,
          document: {
            create: { pdf: new Uint8Array(pdf), sha256: receiptPdfSha256(pdf), templateVersion: RECEIPT_TEMPLATE_VERSION },
          },
        },
        select: { id: true },
      });
      await recordAuditInTransaction(tx, session, {
        action: "receipt.generate",
        summary: auditSummary("Generated", data),
        entityType: "Receipt",
        entityId: row.id,
      });
      return row.id;
    }, TX);
    revalidatePath(RECEIPTS_PATH);
    return { ok: true, receipt: { id, data, pdf, rebuilt: false } };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await reuse();
    if (winner) return winner;
    throw error;
  }
}

export async function generateReceiptAction(input: ReceiptInput, requestKey: string): Promise<GenerateReceiptResult> {
  const session = await requireAdmin();
  if (!isReceiptRequestKey(requestKey)) return { ok: false, error: RELOAD };
  const result = validateReceiptInput(input, { requireEmail: false });
  if (!result.ok) return result;

  const saved = await saveReceipt(session, result.data, requestKey);
  if (!saved.ok) return saved;
  const { receipt } = saved;
  return {
    ok: true,
    id: receipt.id,
    filename: receiptFilename(receipt.data, { rebuilt: receipt.rebuilt }),
    pdfBase64: Buffer.from(receipt.pdf).toString("base64"),
    rebuilt: receipt.rebuilt,
  };
}

type Claim =
  | { state: "claimed"; attemptId: string }
  | { state: "missing" }
  | { state: "sent"; sentTo: string }
  | { state: "sending" }
  | { state: "unknown" };

const sameAddress = (a: string | null, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

/**
 * Records that this request is about to email the receipt (PENDING), unless
 * it shouldn't: an attempt still in progress blocks any other, and the same
 * request (same key, same address) that already sent it, or whose earlier
 * try never finished, doesn't send again. The row is locked while deciding
 * so two requests can't both claim it; the lock is released before any
 * email is sent.
 */
async function claimEmailAttempt(receiptId: string, requestKey: string, address: string): Promise<Claim> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Receipt" WHERE "id" = ${receiptId} FOR UPDATE`;
    if (locked.length === 0) return { state: "missing" };
    const row = await tx.receipt.findUniqueOrThrow({
      where: { id: receiptId },
      select: { emailStatus: true, emailAttemptKey: true, emailAttemptTo: true, emailAttemptId: true, emailAttemptAt: true, emailedTo: true },
    });

    const sameRequest = row.emailAttemptKey === requestKey && sameAddress(row.emailAttemptTo, address);
    if (row.emailStatus === "PENDING") {
      const started = row.emailAttemptAt?.getTime() ?? 0;
      if (Date.now() - started < EMAIL_ATTEMPT_STALE_MS) return { state: "sending" };
      // Never finished. The same request may not send again — the first try
      // might have gone out — but a deliberate new send (another key) may.
      if (sameRequest) return { state: "unknown" };
    }
    if (row.emailStatus === "SENT" && sameRequest) return { state: "sent", sentTo: row.emailedTo ?? address };

    const attemptId = randomUUID();
    // Conditional on the attempt read above, as a second guard alongside the lock.
    const claimed = await tx.receipt.updateMany({
      where: { id: receiptId, emailAttemptId: row.emailAttemptId },
      data: {
        emailStatus: "PENDING",
        emailAttemptId: attemptId,
        emailAttemptKey: requestKey,
        emailAttemptTo: address,
        emailAttemptAt: new Date(),
        emailError: null,
      },
    });
    if (claimed.count !== 1) return { state: "sending" };
    return { state: "claimed", attemptId };
  }, TX);
}

/**
 * Emails a saved receipt's PDF (BCC to the records address) with a durable
 * record either way: the attempt is saved as PENDING before the email is
 * handed to Resend, then SENT or FAILED (with Resend's reason) after. No
 * transaction is open while it sends. A database failure after the send can
 * only leave the attempt PENDING — never an email with no record, and the
 * claim above stops a retry from sending it twice.
 */
async function emailIssuedReceipt(
  session: SessionPayload,
  receipt: IssuedReceipt,
  requestKey: string,
  address: string,
  verb: "Emailed" | "Re-emailed"
): Promise<EmailReceiptResult> {
  // Read before claiming, so nothing but the send itself sits between
  // marking the attempt PENDING and handing the email to Resend.
  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { email: true } });
  const claim = await claimEmailAttempt(receipt.id, requestKey, address);
  switch (claim.state) {
    case "missing":
      return { ok: false, error: "That receipt no longer exists." };
    case "sent":
      return { ok: true, id: receipt.id, sentTo: claim.sentTo, alreadySent: true };
    case "sending":
      return {
        ok: false,
        error: "This receipt is being emailed right now. Wait a moment, then check the Emailed to column in the history below.",
      };
    case "unknown":
      return {
        ok: false,
        error:
          "An earlier try to email this receipt never finished, so it may or may not have gone out. Check with the recipient, or use Resend in the history below to send it again.",
      };
  }

  const result = await sendReceiptEmail(address, {
    isDonation: receipt.data.kind === "DONATION",
    receivedFrom: receipt.data.receivedFrom,
    amountLabel: formatReceiptMoney(receipt.data.amountCents),
    // The family's copy keeps the usual name even when rebuilt; the
    // "_rebuilt" label is for the Admin downloading it from the history.
    filename: receiptFilename(receipt.data),
    pdf: receipt.pdf,
    bcc: RECEIPT_RECORDS_EMAIL,
    replyTo: me?.email ?? undefined,
    // Resend returns this attempt's first result for a repeat of the same key.
    idempotencyKey: `pack376-receipt/${receipt.id}/${claim.attemptId}`,
  });

  const thisAttempt = { id: receipt.id, emailAttemptId: claim.attemptId, emailStatus: "PENDING" as const };
  if (result.sent) {
    try {
      await prisma.receipt.updateMany({
        where: thisAttempt,
        data: { emailStatus: "SENT", emailedTo: address, emailedAt: new Date(), emailError: null },
      });
    } catch (error) {
      // The email did go out; the row stays PENDING, which blocks a resend of
      // this same request rather than risking a second copy.
      console.error(`Receipt ${receipt.id} was emailed but its status couldn't be saved:`, error);
    }
    await recordAudit(session, {
      action: "receipt.email",
      summary: auditSummary(verb, receipt.data, ` to ${address}`),
      entityType: "Receipt",
      entityId: receipt.id,
    });
    revalidatePath(RECEIPTS_PATH);
    return { ok: true, id: receipt.id, sentTo: address };
  }

  const reason = result.configured ? (result.error ?? "Unknown error") : "Email isn't set up on the server.";
  try {
    await prisma.receipt.updateMany({
      where: thisAttempt,
      data: { emailStatus: "FAILED", emailError: reason.slice(0, MAX_EMAIL_ERROR_LENGTH) },
    });
  } catch (error) {
    // Nothing went out; left PENDING, the row only holds up a retry until it goes stale.
    console.error(`Receipt ${receipt.id}'s failed email couldn't be recorded:`, error);
  }
  await recordAudit(session, {
    action: "receipt.emailFailed",
    summary: auditSummary(`Tried to ${verb === "Emailed" ? "email" : "re-email"}`, receipt.data, ` to ${address}, but it didn't go out`),
    entityType: "Receipt",
    entityId: receipt.id,
  });
  revalidatePath(RECEIPTS_PATH);
  return {
    ok: false,
    error: `Saved to the history below, but the email to ${address} didn't go out (${reason}). Check the address and try again, use Resend on that row, or use Download PDF and send it yourself.`,
  };
}

export async function emailReceiptAction(input: ReceiptInput, requestKey: string): Promise<EmailReceiptResult> {
  const session = await requireAdmin();
  if (!isReceiptRequestKey(requestKey)) return { ok: false, error: RELOAD };
  const result = validateReceiptInput(input, { requireEmail: true });
  if (!result.ok) return result;
  // Checked before anything is saved: with no email service, Download is the way to go.
  if (!isEmailConfigured()) return { ok: false, error: NOT_CONFIGURED };

  const saved = await saveReceipt(session, result.data, requestKey);
  if (!saved.ok) return saved;
  return emailIssuedReceipt(session, saved.receipt, requestKey, result.emailTo, "Emailed");
}

/**
 * Emails a saved receipt again, to the same address or a different one —
 * the stored PDF exactly as issued (or, for a receipt saved before PDFs were
 * kept, one rebuilt from what was saved). "Emailed to" shows the latest
 * send and the audit log keeps each one. `requestKey` is made when the
 * Resend form opens, so a retried Send doesn't email it twice.
 */
export async function resendReceiptAction(id: string, emailTo: string, requestKey: string): Promise<EmailReceiptResult> {
  const session = await requireAdmin();
  if (!isReceiptRequestKey(requestKey)) return { ok: false, error: RELOAD };
  const address = String(emailTo ?? "").trim();
  if (!address) return { ok: false, error: "Enter the email address to send the receipt to." };
  if (!isValidReceiptEmail(address)) return { ok: false, error: "That email address doesn't look right." };
  if (!isEmailConfigured()) return { ok: false, error: NOT_CONFIGURED };

  const issued = typeof id === "string" && id ? await issuedReceipt({ id }) : null;
  if (!issued) return { ok: false, error: "That receipt no longer exists." };
  if (!issued.ok) return issued;
  return emailIssuedReceipt(session, issued.receipt, requestKey, address, "Re-emailed");
}

/**
 * A saved receipt's PDF exactly as it was issued. Receipts saved before
 * issued PDFs were kept come back rebuilt from their saved details — marked
 * `rebuilt`, with "_rebuilt" in the file name — since today's layout may
 * differ from the one that went out.
 */
export async function downloadSavedReceiptAction(id: string): Promise<GenerateReceiptResult> {
  await requireAdmin();
  const issued = typeof id === "string" && id ? await issuedReceipt({ id }) : null;
  if (!issued) return { ok: false, error: "That receipt no longer exists." };
  if (!issued.ok) return issued;
  const { receipt } = issued;
  return {
    ok: true,
    id: receipt.id,
    filename: receiptFilename(receipt.data, { rebuilt: receipt.rebuilt }),
    pdfBase64: Buffer.from(receipt.pdf).toString("base64"),
    rebuilt: receipt.rebuilt,
  };
}

export type DeleteReceiptResult = { ok: true } | { ok: false; error: string };

/**
 * Removes a receipt (and its stored PDF) from the history, for one entered by
 * mistake. The row is gone for good, so the audit entry — written in the
 * same transaction — records everything it said, and an email that already
 * went out is not unsent.
 */
export async function deleteReceiptAction(id: string): Promise<DeleteReceiptResult> {
  const session = await requireAdmin();
  if (typeof id !== "string" || !id) return { ok: false, error: "That receipt was already deleted." };

  const deleted = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Receipt" WHERE "id" = ${id} FOR UPDATE`;
    if (locked.length === 0) return false;
    const record = await tx.receipt.delete({ where: { id } });
    const data = receiptDataFromRecord(record);
    await recordAuditInTransaction(tx, session, {
      action: "receipt.delete",
      summary: auditSummary(
        "Deleted",
        data,
        ` dated ${data.date}${record.emailedTo ? `, which had been emailed to ${record.emailedTo}` : ""}`
      ),
      entityType: "Receipt",
      entityId: record.id,
    });
    return true;
  }, TX);
  if (!deleted) return { ok: false, error: "That receipt was already deleted." };

  revalidatePath(RECEIPTS_PATH);
  return { ok: true };
}
