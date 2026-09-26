import "server-only";
import { Resend } from "resend";

const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS || "Pack 376 Portal <onboarding@resend.dev>";

let client: Resend | null = null;
function getClient() {
  if (!process.env.RESEND_API_KEY) return null;
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

/**
 * Emails a one-time link that lets the account holder set their own password
 * — never a plaintext password itself. Returns { sent: false } without
 * throwing whenever RESEND_API_KEY isn't configured (local dev, or before the
 * pack sets one up) or the send fails, so callers can fall back to showing
 * the link on screen for the admin to relay manually.
 */
export async function sendAccountLinkEmail(
  to: string,
  opts: { username: string; url: string; isNewAccount: boolean }
): Promise<{ sent: boolean }> {
  const resend = getClient();
  if (!resend) return { sent: false };

  const subject = opts.isNewAccount
    ? "Set up your Pack 376 Portal account"
    : "Reset your Pack 376 Portal password";
  const intro = opts.isNewAccount
    ? `An account has been created for you on the Pack 376 Portal.<br/><strong>Username:</strong> ${opts.username}`
    : `A password reset was requested for your Pack 376 Portal account.<br/><strong>Username:</strong> ${opts.username}`;
  const expiryNote = opts.isNewAccount ? "This link expires in 48 hours" : "This link expires in 60 minutes";

  const actionLabel = opts.isNewAccount ? "Set your password" : "Choose a new password";
  const introText = opts.isNewAccount
    ? `An account has been created for you on the Pack 376 Portal.\nUsername: ${opts.username}`
    : `A password reset was requested for your Pack 376 Portal account.\nUsername: ${opts.username}`;

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject,
    html: `
      <p>${intro}</p>
      <p><a href="${opts.url}">${actionLabel}</a></p>
      <p>${expiryNote} and can only be used once. If you weren't expecting this, you can ignore this email.</p>
    `,
    // A plain-text alternative alongside html isn't just a nicety — mail
    // filters score HTML-only messages as more spam-like, and this domain is
    // still building sender reputation.
    text: `${introText}\n\n${actionLabel}: ${opts.url}\n\n${expiryNote} and can only be used once. If you weren't expecting this, you can ignore this email.`,
  });

  return { sent: !error };
}

/**
 * The photo-consent email itself, shared by the one-scout and Email All sends.
 * After a parent submits, their link stops working (the token rotates), so the
 * email points them at their den leader for any later change rather than
 * promising they can reuse it.
 */
function photoConsentEmailContent(scoutFirstName: string, url: string) {
  return {
    subject: `Photo consent form for ${scoutFirstName} — Pack 376`,
    html: `
      <p>Pack 376 is asking for your permission to use photos of <strong>${scoutFirstName}</strong> on Instagram/Facebook, the pack website, and printed event/recruitment fliers.</p>
      <p><a href="${url}">Fill out the photo consent form</a></p>
      <p>You can choose to consent or decline for each one separately. If you need to change your answers after submitting, just let your den leader know.</p>
    `,
    // See the note in sendAccountLinkEmail — a plain-text part helps spam
    // scoring, which matters while this domain is still building reputation.
    text: `Pack 376 is asking for your permission to use photos of ${scoutFirstName} on Instagram/Facebook, the pack website, and printed event/recruitment fliers.\n\nFill out the photo consent form: ${url}\n\nYou can choose to consent or decline for each one separately. If you need to change your answers after submitting, just let your den leader know.`,
  };
}

/**
 * Emails a scout's photo-consent link to a parent. Same graceful fallback as
 * sendAccountLinkEmail: returns { sent: false } without throwing when
 * RESEND_API_KEY isn't configured, so the caller can fall back to showing the
 * link on screen for the leader to relay manually. `configured` distinguishes
 * that case from a real Resend failure (bad address, API error, etc.) so the
 * UI doesn't tell an admin to "configure" something that already is — the
 * actual error is logged server-side either way since Resend errors used to
 * vanish silently here.
 */
export async function sendPhotoConsentLinkEmail(
  to: string,
  opts: { scoutFirstName: string; url: string }
): Promise<{ sent: boolean; configured: boolean }> {
  const resend = getClient();
  if (!resend) return { sent: false, configured: false };

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    ...photoConsentEmailContent(opts.scoutFirstName, opts.url),
  });

  if (error) {
    console.error(`sendPhotoConsentLinkEmail failed for ${to}:`, error);
  }

  return { sent: !error, configured: true };
}

// Resend's batch endpoint takes at most 100 emails per request.
const BATCH_LIMIT = 100;

/**
 * Email All: each family's own consent link, through Resend's batch endpoint
 * rather than one request per email — Resend rate-limits individual sends to
 * a few per second, which a whole pack's worth would trip. "Permissive"
 * validation lets one bad address fail on its own instead of sinking the
 * batch. `sent[i]` says whether messages[i] went out.
 */
export async function sendPhotoConsentLinkEmails(
  messages: { to: string; scoutFirstName: string; url: string }[]
): Promise<{ sent: boolean[]; configured: boolean }> {
  const resend = getClient();
  if (!resend) return { sent: messages.map(() => false), configured: false };

  const sent: boolean[] = [];
  for (let start = 0; start < messages.length; start += BATCH_LIMIT) {
    const chunk = messages.slice(start, start + BATCH_LIMIT);
    const { data, error } = await resend.batch.send(
      chunk.map((m) => ({ from: FROM_ADDRESS, to: m.to, ...photoConsentEmailContent(m.scoutFirstName, m.url) })),
      { batchValidation: "permissive" }
    );
    if (error || !data) {
      console.error("sendPhotoConsentLinkEmails batch failed:", error);
      sent.push(...chunk.map(() => false));
      continue;
    }
    const errors = data.errors ?? [];
    const failed = new Set(errors.map((e) => e.index));
    for (const e of errors) {
      console.error(`sendPhotoConsentLinkEmails failed for ${chunk[e.index]?.to}:`, e.message);
    }
    sent.push(...chunk.map((_, i) => !failed.has(i)));
  }

  return { sent, configured: true };
}
