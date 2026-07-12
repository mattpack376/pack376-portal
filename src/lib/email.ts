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
 * Emails a login's credentials to its account holder. Returns { sent: false }
 * without throwing whenever RESEND_API_KEY isn't configured (local dev, or
 * before the pack sets one up) or the send fails, so callers can fall back to
 * showing the credential on screen like before.
 */
export async function sendCredentialEmail(
  to: string,
  opts: { username: string; password: string; isNewAccount: boolean }
): Promise<{ sent: boolean }> {
  const resend = getClient();
  if (!resend) return { sent: false };

  const subject = opts.isNewAccount
    ? "Your Pack 376 Portal account"
    : "Your Pack 376 Portal password was reset";
  const intro = opts.isNewAccount
    ? "An account has been created for you on the Pack 376 Portal."
    : "Your Pack 376 Portal password has been reset.";

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject,
    html: `
      <p>${intro}</p>
      <p><strong>Username:</strong> ${opts.username}<br/><strong>Password:</strong> ${opts.password}</p>
      <p>Sign in at <a href="https://portal.pack376nyc.org/portal/login">portal.pack376nyc.org</a>.</p>
    `,
  });

  return { sent: !error };
}
