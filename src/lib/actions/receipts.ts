"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin } from "@/lib/authorize";
import { recordAudit, recordAuditInTransaction } from "@/lib/audit";
import { MAX_EMAIL_ERROR_LENGTH, isDeliverableAddress, isEmailConfigured, sendReceiptEmail } from "@/lib/email";
import { RECEIPT_TEMPLATE_VERSION, buildReceiptPdf, receiptPdfSha256 } from "@/lib/receiptPdf";
import type { SessionPayload } from "@/lib/session";
import {
  EMAIL_ATTEMPT_STALE_MS,
  PROVIDER_KEY_REUSE_MS,
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

const SIGNED_OUT = "You've been signed out, so this didn't go through. Reload the page to sign in again.";
const ADMINS_ONLY = "Only Admins can use receipts, so this didn't go through.";

/**
 * The signed-in Admin, or the reason there isn't one — returned, not thrown.
 * A thrown error reaches the page the same way as a call that got no answer
 * at all, so the receipt controls would have to say they don't know whether
 * anything was saved or sent and to press again; here it's certain nothing
 * was, and pressing again would never help.
 */
async function adminSession(): Promise<{ ok: true; session: SessionPayload } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: SIGNED_OUT };
  try {
    assertAdmin(session);
  } catch {
    return { ok: false, error: ADMINS_ONLY };
  }
  return { ok: true, session };
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
  const admin = await adminSession();
  if (!admin.ok) return admin;
  const { session } = admin;
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
  | {
      state: "claimed";
      attemptId: string;
      tryCount: number;
      /** Resend's Idempotency-Key for this try. */
      providerKey: string;
      /** True when this try reuses an earlier try's key because that one may have gone out. */
      reusedKey: boolean;
      to: string;
      replyTo: string | null;
    }
  | { state: "missing" }
  | { state: "sent"; sentTo: string }
  | { state: "sending" }
  | { state: "unknown"; to: string };

const addressKey = (address: string) => address.toLowerCase();
const providerKeyFor = (receiptId: string, attemptId: string, tryCount: number) =>
  `pack376-receipt/${receiptId}/${attemptId}/${tryCount}`;

/** A send that's still under way: PENDING, and not yet old enough to count as abandoned. */
function isInFlight(attempt: { status: string; startedAt: Date }, now: number) {
  return attempt.status === "PENDING" && now - attempt.startedAt.getTime() < EMAIL_ATTEMPT_STALE_MS;
}

/**
 * Records that this request is about to email the receipt (PENDING), unless
 * it shouldn't. A request is a request key plus the address it named (in any
 * letter case), and each has its own ReceiptEmailAttempt row, so:
 *
 * - one that already sent the receipt never sends again, whatever other
 *   sends of the receipt (other addresses, other Resends) came in between;
 * - any send of the receipt still under way holds up every other;
 * - one whose earlier try Resend refused tries again under a new Resend key;
 * - one whose earlier try may have gone out (Resend didn't answer clearly, or
 *   the server stopped mid-send) tries again only under that try's own key,
 *   to the same address with the same reply-to, so Resend hands back the
 *   first result instead of sending a second copy — and once that key is too
 *   old for Resend to remember, not at all.
 *
 * The receipt row is locked while deciding, so two requests can't both
 * claim it; the lock is released before any email is sent.
 */
async function claimEmailAttempt(
  receiptId: string,
  requestKey: string,
  address: string,
  replyTo: string | null
): Promise<Claim> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Receipt" WHERE "id" = ${receiptId} FOR UPDATE`;
    if (locked.length === 0) return { state: "missing" };
    const now = new Date();
    const attempts = await tx.receiptEmailAttempt.findMany({
      where: { receiptId },
      select: {
        id: true,
        requestKey: true,
        addressKey: true,
        address: true,
        status: true,
        tryCount: true,
        startedAt: true,
        providerKey: true,
        providerKeyAt: true,
        mayHaveSent: true,
        replyTo: true,
      },
    });
    const mine = attempts.find((a) => a.requestKey === requestKey && a.addressKey === addressKey(address));

    if (mine?.status === "SENT") return { state: "sent", sentTo: mine.address };
    if (attempts.some((a) => isInFlight(a, now.getTime()))) return { state: "sending" };

    if (!mine) {
      const attemptId = randomUUID();
      const providerKey = providerKeyFor(receiptId, attemptId, 1);
      await tx.receiptEmailAttempt.create({
        data: {
          id: attemptId,
          receiptId,
          requestKey,
          address,
          addressKey: addressKey(address),
          status: "PENDING",
          tryCount: 1,
          providerKey,
          providerKeyAt: now,
          replyTo,
          startedAt: now,
        },
      });
      return { state: "claimed", attemptId, tryCount: 1, providerKey, reusedKey: false, to: address, replyTo };
    }

    // A retry of this request: its last try FAILED, or never finished.
    const unconfirmed = mine.status === "PENDING" || mine.mayHaveSent;
    const tryCount = mine.tryCount + 1;
    let next: { providerKey: string; providerKeyAt: Date; replyTo: string | null };
    if (unconfirmed) {
      if (now.getTime() - mine.providerKeyAt.getTime() >= PROVIDER_KEY_REUSE_MS) return { state: "unknown", to: mine.address };
      next = { providerKey: mine.providerKey, providerKeyAt: mine.providerKeyAt, replyTo: mine.replyTo };
    } else {
      // Resend refused the last try, so nothing went out under its key; a
      // fresh one keeps Resend from handing back that same refusal.
      next = { providerKey: providerKeyFor(receiptId, mine.id, tryCount), providerKeyAt: now, replyTo };
    }
    // Conditional on the try read above, as a second guard alongside the lock.
    const claimed = await tx.receiptEmailAttempt.updateMany({
      where: { id: mine.id, status: mine.status, tryCount: mine.tryCount },
      data: { ...next, status: "PENDING", tryCount, startedAt: now, finishedAt: null, error: null, mayHaveSent: unconfirmed },
    });
    if (claimed.count !== 1) return { state: "sending" };
    return { state: "claimed", attemptId: mine.id, tryCount, reusedKey: unconfirmed, to: mine.address, ...next };
  }, TX);
}

/**
 * Emails a saved receipt's PDF (BCC to the records address) with a durable
 * record either way: the request is saved as PENDING before the email is
 * handed to Resend, then SENT or FAILED (with Resend's reason, and whether
 * it may have gone out anyway) after. No transaction is open while it sends.
 * A database failure after the send can only leave the request PENDING —
 * never an email with no record — and the claim above then retries it only
 * under the same Resend key.
 */
async function emailIssuedReceipt(
  session: SessionPayload,
  receipt: IssuedReceipt,
  requestKey: string,
  address: string,
  verb: "Emailed" | "Re-emailed"
): Promise<EmailReceiptResult> {
  // Read before claiming, so nothing but the send itself sits between
  // marking the request PENDING and handing the email to Resend. The reply-to
  // is saved with the request, so a retry under the same Resend key sends
  // exactly the same message (Resend refuses a reused key otherwise).
  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { email: true } });
  const replyTo = me?.email && isDeliverableAddress(me.email) ? me.email : null;
  const claim = await claimEmailAttempt(receipt.id, requestKey, address, replyTo);
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
        error: `An earlier try to email this receipt to ${claim.to} was never confirmed, and it's too long ago to retry safely, so it may or may not have gone out. Check with the recipient, or use Resend in the history below to send another copy.`,
      };
  }

  const result = await sendReceiptEmail(claim.to, {
    isDonation: receipt.data.kind === "DONATION",
    receivedFrom: receipt.data.receivedFrom,
    amountLabel: formatReceiptMoney(receipt.data.amountCents),
    // The family's copy keeps the usual name even when rebuilt; the
    // "_rebuilt" label is for the Admin downloading it from the history.
    filename: receiptFilename(receipt.data),
    pdf: receipt.pdf,
    bcc: RECEIPT_RECORDS_EMAIL,
    replyTo: claim.replyTo ?? undefined,
    // Resend returns the first result for a repeat of the same key (and the same message).
    idempotencyKey: claim.providerKey,
  });

  const thisTry = { id: claim.attemptId, status: "PENDING" as const, tryCount: claim.tryCount };
  const finishedAt = new Date();
  if (result.sent) {
    try {
      // The receipt row before its attempt, the order delete locks them in.
      await prisma.$transaction([
        prisma.receipt.updateMany({ where: { id: receipt.id }, data: { emailedTo: claim.to, emailedAt: finishedAt } }),
        prisma.receiptEmailAttempt.updateMany({ where: thisTry, data: { status: "SENT", finishedAt, error: null } }),
      ]);
    } catch (error) {
      // The email did go out; the request stays PENDING, and a retry of it
      // reuses this try's Resend key rather than risking a second copy.
      console.error(`Receipt ${receipt.id} was emailed but its status couldn't be saved:`, error);
    }
    await recordAudit(session, {
      action: "receipt.email",
      summary: auditSummary(
        verb,
        receipt.data,
        ` to ${claim.to}${claim.reusedKey ? " (a retry of an unconfirmed try, under the same Resend key, so at most one copy went out)" : ""}`
      ),
      entityType: "Receipt",
      entityId: receipt.id,
    });
    revalidatePath(RECEIPTS_PATH);
    return { ok: true, id: receipt.id, sentTo: claim.to };
  }

  const reason = result.configured ? (result.error ?? "Unknown error") : "Email isn't set up on the server.";
  const uncertain = result.configured && result.uncertain === true;
  // A retry under an unconfirmed try's key that Resend now turns down still
  // leaves that earlier try unaccounted for, so it's never "didn't go out".
  const mayHaveGoneOut = uncertain || claim.reusedKey;
  try {
    await prisma.receiptEmailAttempt.updateMany({
      where: thisTry,
      // mayHaveSent is only ever turned on: once a try may have gone out,
      // every later try of this request has to reuse its key.
      data: { status: "FAILED", finishedAt, error: reason.slice(0, MAX_EMAIL_ERROR_LENGTH), ...(uncertain ? { mayHaveSent: true } : {}) },
    });
  } catch (error) {
    // Left PENDING, the request holds up other sends until it goes stale and
    // is then retried only under this try's key — safe either way.
    console.error(`Receipt ${receipt.id}'s failed email couldn't be recorded:`, error);
  }
  await recordAudit(session, {
    action: "receipt.emailFailed",
    summary: auditSummary(
      `Tried to ${verb === "Emailed" ? "email" : "re-email"}`,
      receipt.data,
      ` to ${claim.to}, but ${mayHaveGoneOut ? "Resend didn't confirm whether it went out" : "it didn't go out"}`
    ),
    entityType: "Receipt",
    entityId: receipt.id,
  });
  revalidatePath(RECEIPTS_PATH);
  return { ok: false, error: failureMessage(verb, claim.to, reason, mayHaveGoneOut) };
}

/**
 * What the Admin is told when a send didn't (or may not have) gone out. The
 * receipt itself is always saved by then. Resend's reason goes in brackets
 * without its own closing period, so the sentence doesn't end in ".)."
 */
function failureMessage(verb: "Emailed" | "Re-emailed", to: string, reason: string, uncertain: boolean) {
  const because = reason.trim().replace(/[.!\s]+$/, "") || "no reason given";
  const fromForm = verb === "Emailed";
  if (uncertain) {
    // Pressing the same button again repeats the same request (the form and
    // an open Resend form keep their key), which is what makes it safe.
    return (
      (fromForm ? "Saved to the history below, but " : "") +
      `Resend didn't confirm whether the email to ${to} went out (${because}). ` +
      `Press ${fromForm ? "Email" : "Send"} again to retry: if the first one did go out, it won't be sent twice.`
    );
  }
  return fromForm
    ? `Saved to the history below, but the email to ${to} didn't go out (${because}). Check the address and try again, use Retry email on that row, or use Download PDF and send it yourself.`
    : `The email to ${to} didn't go out (${because}). Check the address and try again, or use Download PDF and send it yourself.`;
}

export async function emailReceiptAction(input: ReceiptInput, requestKey: string): Promise<EmailReceiptResult> {
  const admin = await adminSession();
  if (!admin.ok) return admin;
  const { session } = admin;
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
  const admin = await adminSession();
  if (!admin.ok) return admin;
  const { session } = admin;
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
  const admin = await adminSession();
  if (!admin.ok) return admin;
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

/** Each address once (letter case aside), in the order first seen. */
function distinctAddresses(addresses: (string | null)[]) {
  const seen = new Map<string, string>();
  for (const address of addresses) {
    if (address && !seen.has(addressKey(address))) seen.set(addressKey(address), address);
  }
  return [...seen.values()];
}

/**
 * Removes a receipt (and its stored PDF and email requests) from the
 * history, for one entered by mistake. The row is gone for good, so the audit
 * entry — written in the same transaction — records everything it said,
 * including every address it went to and any send never confirmed either
 * way; an email that already went out is not unsent. While the receipt is
 * being emailed it can't be deleted: the send's result would have nowhere to
 * be recorded, and this entry couldn't say whether it went out.
 */
export async function deleteReceiptAction(id: string): Promise<DeleteReceiptResult> {
  const admin = await adminSession();
  if (!admin.ok) return admin;
  const { session } = admin;
  if (typeof id !== "string" || !id) return { ok: false, error: "That receipt was already deleted." };

  const outcome = await prisma.$transaction(async (tx) => {
    // The same row lock a send's claim takes, so no send can start (or be
    // seen half-started) while this decides.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Receipt" WHERE "id" = ${id} FOR UPDATE`;
    if (locked.length === 0) return "missing" as const;
    const attempts = await tx.receiptEmailAttempt.findMany({
      where: { receiptId: id },
      orderBy: { createdAt: "asc" },
      select: { status: true, address: true, startedAt: true, mayHaveSent: true },
    });
    const now = Date.now();
    if (attempts.some((a) => isInFlight(a, now))) return "sending" as const;

    const record = await tx.receipt.delete({ where: { id } });
    const data = receiptDataFromRecord(record);
    const sentTo = distinctAddresses([...attempts.filter((a) => a.status === "SENT").map((a) => a.address), record.emailedTo]);
    const sentKeys = new Set(sentTo.map(addressKey));
    const unconfirmed = distinctAddresses(
      attempts.filter((a) => a.status === "PENDING" || (a.status === "FAILED" && a.mayHaveSent)).map((a) => a.address)
    ).filter((address) => !sentKeys.has(addressKey(address)));
    await recordAuditInTransaction(tx, session, {
      action: "receipt.delete",
      summary: auditSummary(
        "Deleted",
        data,
        ` dated ${data.date}` +
          (sentTo.length ? `, which had been emailed to ${sentTo.join(", ")}` : "") +
          (unconfirmed.length ? `; an email to ${unconfirmed.join(", ")} was never confirmed either way` : "")
      ),
      entityType: "Receipt",
      entityId: record.id,
    });
    return "deleted" as const;
  }, TX);
  if (outcome === "missing") return { ok: false, error: "That receipt was already deleted." };
  if (outcome === "sending") {
    return { ok: false, error: "This receipt is being emailed right now. Wait a moment, then try deleting it again." };
  }

  revalidatePath(RECEIPTS_PATH);
  return { ok: true };
}
