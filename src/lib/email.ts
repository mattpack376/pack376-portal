import "server-only";
import { Resend } from "resend";
import { getAppBaseUrl, getPublicBaseUrl } from "@/lib/appUrl";
import { isValidEmail } from "@/lib/formValues";

const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS || "Pack 376 Portal <onboarding@resend.dev>";

let client: Resend | null = null;
function getClient() {
  if (!process.env.RESEND_API_KEY) return null;
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

/** Whether a send would be attempted at all, so a caller can say so before saving anything. */
export function isEmailConfigured() {
  return !!process.env.RESEND_API_KEY;
}

/** How much of a provider's error message is kept; Resend's own are a sentence or two. */
export const MAX_EMAIL_ERROR_LENGTH = 500;

/**
 * Every sender's result. `configured` tells "no RESEND_API_KEY" apart from a
 * real failure; `error` is a short reason when a configured send didn't go
 * out (a refused address or link, or what Resend said).
 */
export type SendResult = { sent: boolean; configured: boolean; error?: string };

/*
 * Everything put into an email's HTML that didn't come from this file — a
 * username, a scout's first name, a donor's name — is text, not markup:
 * staff type those values and they're stored as typed, so a name like
 * `<a href="…">` must show up as those characters, never as a link. Every
 * such value goes through escapeHtml, which is safe both between tags and
 * inside a double-quoted attribute.
 */
export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A stored value as one line of plain text, for a subject or a text part:
 * control characters and line breaks become a space, so a name can't start
 * a new paragraph (a fake "click here" line) or a new header of its own.
 * Nothing is entity-encoded — the text part shows the name exactly as typed.
 */
function oneLine(value: string) {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").trim();
}

/** Thrown by a builder handed a link this app didn't generate. */
export class UntrustedLinkError extends Error {
  constructor() {
    super("The link isn't one of this site's own addresses.");
    this.name = "UntrustedLinkError";
  }
}

/**
 * Only this site's own links go into an email: the portal and public hosts
 * from appUrl.ts (https in production; the local hosts in development). The
 * URL is parsed, so "https://pack376nyc.org@elsewhere.example" or
 * "javascript:" can't pass as ours, and its normalized form is what's used.
 */
function trustedAppLink(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UntrustedLinkError();
  }
  const ownOrigins = [getAppBaseUrl(), getPublicBaseUrl()].map((base) => new URL(base).origin);
  const httpsRequired = process.env.NODE_ENV === "production";
  if (
    !ownOrigins.includes(url.origin) ||
    url.username ||
    url.password ||
    (httpsRequired && url.protocol !== "https:")
  ) {
    throw new UntrustedLinkError();
  }
  return url.href;
}

export type EmailContent = { subject: string; html: string; text: string };

/**
 * The set-up / reset-password email: a one-time link that lets the account
 * holder set their own password — never a plaintext password itself.
 * Throws UntrustedLinkError for a link that isn't this site's.
 */
export function accountLinkEmail(opts: { username: string; url: string; isNewAccount: boolean }): EmailContent {
  const href = trustedAppLink(opts.url);
  const username = oneLine(opts.username);

  const subject = opts.isNewAccount
    ? "Set up your Pack 376 Portal account"
    : "Reset your Pack 376 Portal password";
  const lead = opts.isNewAccount
    ? "An account has been created for you on the Pack 376 Portal."
    : "A password reset was requested for your Pack 376 Portal account.";
  const expiryNote = opts.isNewAccount ? "This link expires in 48 hours" : "This link expires in 60 minutes";
  const actionLabel = opts.isNewAccount ? "Set your password" : "Choose a new password";

  return {
    subject,
    html: `
      <p>${lead}<br/><strong>Username:</strong> ${escapeHtml(username)}</p>
      <p><a href="${escapeHtml(href)}">${actionLabel}</a></p>
      <p>${expiryNote} and can only be used once. If you weren't expecting this, you can ignore this email.</p>
    `,
    // A plain-text alternative alongside html isn't just a nicety — mail
    // filters score HTML-only messages as more spam-like, and this domain is
    // still building sender reputation.
    text: `${lead}\nUsername: ${username}\n\n${actionLabel}: ${href}\n\n${expiryNote} and can only be used once. If you weren't expecting this, you can ignore this email.`,
  };
}

/**
 * The photo-consent email itself, shared by the one-scout and Email All sends.
 * After a parent submits, their link stops working (the token rotates), so the
 * email points them at their den leader for any later change rather than
 * promising they can reuse it. Throws UntrustedLinkError for a link that
 * isn't this site's.
 */
export function photoConsentEmail(scoutFirstName: string, url: string): EmailContent {
  const href = trustedAppLink(url);
  const name = oneLine(scoutFirstName);
  return {
    subject: `Photo consent form for ${name} — Pack 376`,
    html: `
      <p>Pack 376 is asking for your permission to use photos of <strong>${escapeHtml(name)}</strong> on Instagram/Facebook, the pack website, and printed event/recruitment fliers.</p>
      <p><a href="${escapeHtml(href)}">Fill out the photo consent form</a></p>
      <p>You can choose to consent or decline for each one separately. If you need to change your answers after submitting, just let your den leader know.</p>
    `,
    // See the note in accountLinkEmail — a plain-text part helps spam
    // scoring, which matters while this domain is still building reputation.
    text: `Pack 376 is asking for your permission to use photos of ${name} on Instagram/Facebook, the pack website, and printed event/recruitment fliers.\n\nFill out the photo consent form: ${href}\n\nYou can choose to consent or decline for each one separately. If you need to change your answers after submitting, just let your den leader know.`,
  };
}

/** The receipt email's words; the receipt itself is the attached PDF. */
export function receiptEmail(opts: { isDonation: boolean; receivedFrom: string; amountLabel: string }): EmailContent {
  const receivedFrom = oneLine(opts.receivedFrom);
  const noun = opts.isDonation ? "donation" : "payment";
  const intro = `Thank you for your ${opts.amountLabel} ${noun} to Cub Scout Pack 376. Your receipt is attached as a PDF; please keep it for your records.`;
  return {
    subject: `Your Pack 376 ${noun} receipt`,
    html: `<p>Hello ${escapeHtml(receivedFrom)},</p><p>${escapeHtml(intro)}</p><p>Cub Scout Pack 376</p>`,
    // See the note in accountLinkEmail — a plain-text part helps spam scoring.
    text: `Hello ${receivedFrom},\n\n${intro}\n\nCub Scout Pack 376`,
  };
}

/** A provider error (returned or thrown) as one short line to store and show. */
function describeError(error: unknown): string {
  const raw =
    error && typeof error === "object" && "message" in error && typeof error.message === "string"
      ? error.message
      : String(error);
  const line = oneLine(raw) || "Unknown error";
  return line.length > MAX_EMAIL_ERROR_LENGTH ? `${line.slice(0, MAX_EMAIL_ERROR_LENGTH - 1)}…` : line;
}

const NOT_ONE_ADDRESS = "The address isn't a single valid email address.";

/**
 * One plain mailbox that can go on an email: isValidEmail's shape (no list,
 * display name, spaces or anything over 254 characters) and no control
 * characters either, which that pattern alone lets through.
 */
export function isDeliverableAddress(value: string) {
  return isValidEmail(value) && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

type Outgoing = EmailContent & {
  to: string;
  bcc?: string;
  replyTo?: string;
  attachments?: { filename: string; content: Buffer }[];
  /**
   * Sent to Resend as its Idempotency-Key: the same key within 24 hours
   * returns the first send's result instead of sending again.
   */
  idempotencyKey?: string;
};

/**
 * Hands one message to Resend. Never throws. The recipient must be one plain
 * mailbox (see isDeliverableAddress) — checked here, not only by the forms,
 * because some of these addresses come from stored records rather than what
 * was just typed.
 */
async function deliver(message: Outgoing): Promise<SendResult> {
  const resend = getClient();
  if (!resend) return { sent: false, configured: false };
  if (!isDeliverableAddress(message.to)) return { sent: false, configured: true, error: NOT_ONE_ADDRESS };
  if (message.bcc !== undefined && !isDeliverableAddress(message.bcc)) {
    return { sent: false, configured: true, error: "The copy (BCC) address isn't a single valid email address." };
  }

  try {
    const { error } = await resend.emails.send(
      {
        from: FROM_ADDRESS,
        to: message.to,
        ...(message.bcc ? { bcc: message.bcc } : {}),
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.attachments ? { attachments: message.attachments } : {}),
      },
      message.idempotencyKey ? { idempotencyKey: message.idempotencyKey } : undefined
    );
    if (error) return { sent: false, configured: true, error: describeError(error) };
    return { sent: true, configured: true };
  } catch (error) {
    return { sent: false, configured: true, error: describeError(error) };
  }
}

/**
 * Emails a one-time link that lets the account holder set their own password.
 * Returns { sent: false } without throwing whenever RESEND_API_KEY isn't
 * configured (local dev, or before the pack sets one up), the address or link
 * is refused, or the send fails, so callers can fall back to showing the link
 * on screen for the admin to relay manually.
 */
export async function sendAccountLinkEmail(
  to: string,
  opts: { username: string; url: string; isNewAccount: boolean }
): Promise<{ sent: boolean }> {
  if (!isEmailConfigured()) return { sent: false };
  let content: EmailContent;
  try {
    content = accountLinkEmail(opts);
  } catch (error) {
    console.error("sendAccountLinkEmail refused its link:", describeError(error));
    return { sent: false };
  }
  const result = await deliver({ to, ...content });
  if (result.error) console.error(`sendAccountLinkEmail failed for ${oneLine(to)}:`, result.error);
  return { sent: result.sent };
}

/**
 * Emails a scout's photo-consent link to a parent. Same graceful fallback as
 * sendAccountLinkEmail: returns { sent: false } without throwing when
 * RESEND_API_KEY isn't configured, so the caller can fall back to showing the
 * link on screen for the leader to relay manually. `configured` distinguishes
 * that case from a real failure (bad address, API error, etc.) so the UI
 * doesn't tell an admin to "configure" something that already is — the
 * actual error is logged server-side either way since Resend errors used to
 * vanish silently here.
 */
export async function sendPhotoConsentLinkEmail(
  to: string,
  opts: { scoutFirstName: string; url: string }
): Promise<SendResult> {
  if (!isEmailConfigured()) return { sent: false, configured: false };
  let content: EmailContent;
  try {
    content = photoConsentEmail(opts.scoutFirstName, opts.url);
  } catch (error) {
    console.error("sendPhotoConsentLinkEmail refused its link:", describeError(error));
    return { sent: false, configured: true, error: describeError(error) };
  }
  const result = await deliver({ to, ...content });
  if (result.error) console.error(`sendPhotoConsentLinkEmail failed for ${oneLine(to)}:`, result.error);
  return result;
}

// Resend's batch endpoint takes at most 100 emails per request.
const BATCH_LIMIT = 100;

/**
 * Email All: each family's own consent link, through Resend's batch endpoint
 * rather than one request per email — Resend rate-limits individual sends to
 * a few per second, which a whole pack's worth would trip. A message with a
 * refused address or link is left out (and reported as not sent) rather than
 * sinking the batch, and "permissive" validation does the same for one
 * Resend turns down. `sent[i]` says whether messages[i] went out.
 */
export async function sendPhotoConsentLinkEmails(
  messages: { to: string; scoutFirstName: string; url: string }[]
): Promise<{ sent: boolean[]; configured: boolean }> {
  const resend = getClient();
  if (!resend) return { sent: messages.map(() => false), configured: false };

  const sent = messages.map(() => false);
  const ready: { index: number; to: string; content: EmailContent }[] = [];
  for (const [index, m] of messages.entries()) {
    if (!isDeliverableAddress(m.to)) {
      console.error(`sendPhotoConsentLinkEmails skipped ${oneLine(m.to)}:`, NOT_ONE_ADDRESS);
      continue;
    }
    try {
      ready.push({ index, to: m.to, content: photoConsentEmail(m.scoutFirstName, m.url) });
    } catch (error) {
      console.error(`sendPhotoConsentLinkEmails skipped ${oneLine(m.to)}:`, describeError(error));
    }
  }

  for (let start = 0; start < ready.length; start += BATCH_LIMIT) {
    const chunk = ready.slice(start, start + BATCH_LIMIT);
    const response = await resend.batch
      .send(
        chunk.map((m) => ({ from: FROM_ADDRESS, to: m.to, ...m.content })),
        { batchValidation: "permissive" }
      )
      .catch((error: unknown) => {
        console.error("sendPhotoConsentLinkEmails batch failed:", describeError(error));
        return null;
      });
    if (!response) continue;
    const { data, error } = response;
    if (error || !data) {
      console.error("sendPhotoConsentLinkEmails batch failed:", error);
      continue;
    }
    const errors = data.errors ?? [];
    const failed = new Set(errors.map((e) => e.index));
    for (const e of errors) {
      console.error(`sendPhotoConsentLinkEmails failed for ${chunk[e.index]?.to}:`, e.message);
    }
    chunk.forEach((m, i) => {
      if (!failed.has(i)) sent[m.index] = true;
    });
  }

  return { sent, configured: true };
}

/**
 * Emails a receipt PDF. Same contract as the other senders: never throws,
 * `configured` tells "no RESEND_API_KEY" apart from a real send failure so
 * the admin is pointed at the Download button in the first case only, and
 * `error` says why a configured send didn't go out. A reply-to that isn't one
 * plain address is left off rather than failing the receipt; the records
 * copy (bcc) is never dropped silently — the send fails instead.
 */
export async function sendReceiptEmail(
  to: string,
  opts: {
    isDonation: boolean;
    receivedFrom: string;
    amountLabel: string;
    filename: string;
    pdf: Uint8Array;
    bcc?: string;
    replyTo?: string;
    idempotencyKey?: string;
  }
): Promise<SendResult> {
  if (!isEmailConfigured()) return { sent: false, configured: false };
  const result = await deliver({
    to,
    ...receiptEmail(opts),
    bcc: opts.bcc,
    replyTo: opts.replyTo && isDeliverableAddress(opts.replyTo) ? opts.replyTo : undefined,
    attachments: [{ filename: opts.filename, content: Buffer.from(opts.pdf) }],
    idempotencyKey: opts.idempotencyKey,
  });
  if (result.error) console.error(`sendReceiptEmail failed for ${oneLine(to)}:`, result.error);
  return result;
}
