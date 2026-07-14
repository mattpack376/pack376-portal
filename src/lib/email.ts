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

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject,
    html: `
      <p>${intro}</p>
      <p><a href="${opts.url}">${opts.isNewAccount ? "Set your password" : "Choose a new password"}</a></p>
      <p>${expiryNote} and can only be used once. If you weren't expecting this, you can ignore this email.</p>
    `,
  });

  return { sent: !error };
}

/**
 * Emails a scout's photo-consent link to a parent. Same graceful fallback as
 * sendAccountLinkEmail: returns { sent: false } without throwing when
 * RESEND_API_KEY isn't configured, so the caller can fall back to showing the
 * link on screen for the leader to relay manually.
 */
export async function sendPhotoConsentLinkEmail(
  to: string,
  opts: { scoutFirstName: string; url: string }
): Promise<{ sent: boolean }> {
  const resend = getClient();
  if (!resend) return { sent: false };

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `Photo consent form for ${opts.scoutFirstName} — Pack 376`,
    html: `
      <p>Pack 376 is asking for your permission to use photos of <strong>${opts.scoutFirstName}</strong> on Facebook, the pack website, and printed event/recruitment fliers.</p>
      <p><a href="${opts.url}">Fill out the photo consent form</a></p>
      <p>You can choose to consent or decline for each one separately, and you're welcome to revisit this link any time to change your answer.</p>
    `,
  });

  return { sent: !error };
}
