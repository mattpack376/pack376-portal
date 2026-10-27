"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { checkRateLimit } from "@vercel/firewall";
import { hashPassword, createSessionCookie } from "@/lib/auth";
import { isWellFormedResetToken, newPasswordProblem } from "@/lib/credentialInput";
import { redeemResetToken, resetLinkStatus } from "@/lib/resetTokens";
import { recordAuditInTransaction } from "@/lib/audit";

export type CompleteResetState = {
  error?: string;
  /** The field the error is about, so the form can mark it. */
  field?: "password" | "confirmPassword";
  /** The link itself can't be used; trying again won't help, a new link will. */
  linkDead?: boolean;
};

const LINK_INVALID =
  "This link is invalid, expired, or has already been used. Ask an admin to send you a new one.";
const ACCOUNT_INACTIVE = "This account is inactive. Ask an admin to make it active again, then request a new link.";

/**
 * Redeems a one-time invite/reset link, lets the account holder set their own
 * password, and signs them straight in — mirroring loginAction's session
 * setup. sessionVersion is bumped again here (on top of whatever bumped it
 * when the reset was initiated) so this stays correct even for flows, like
 * new-account invites, that never bumped it in the first place.
 *
 * Anyone can post here, so the order is cheapest first: the firewall, then
 * the token's shape and the password's length, then one indexed read to see
 * the link is live — and only a live link gets the expensive bcrypt hash. The
 * hash runs with no transaction open; the short transaction in
 * redeemResetToken then rechecks everything under the account's lock, so a
 * newer link or an Admin reset that landed meanwhile wins (see resetTokens.ts).
 */
export async function completeResetAction(
  _prevState: CompleteResetState,
  formData: FormData
): Promise<CompleteResetState> {
  // Before anything else, like loginAction. Enforced by a matching
  // "portal-reset" rate limit rule in the Vercel Firewall dashboard; with no
  // such rule this is a no-op, so the bounds and the cheap link check below
  // are what keep junk requests from costing a bcrypt hash.
  const { rateLimited, error: rateLimitError } = await checkRateLimit("portal-reset", { headers: await headers() });
  // Failing open is silent otherwise — this line in the Vercel logs is the
  // only sign the Firewall rule is gone.
  if (rateLimitError === "not-found") console.error('[rate limit] no "portal-reset" rule in the Vercel Firewall');
  if (rateLimited) {
    // Not audited, for the same reason a rate-limited sign-in isn't.
    return { error: "Too many attempts from this connection. Try again in a few minutes." };
  }

  const token = formData.get("token");
  const rawPassword = formData.get("password");
  const rawConfirm = formData.get("confirmPassword");
  // Passwords are taken exactly as typed: no trimming.
  const password = typeof rawPassword === "string" ? rawPassword : "";
  const confirmPassword = typeof rawConfirm === "string" ? rawConfirm : "";

  if (!isWellFormedResetToken(token)) return { error: LINK_INVALID, linkDead: true };
  const problem = newPasswordProblem(password, confirmPassword);
  if (problem) return problem;

  const status = await resetLinkStatus(token);
  if (status === "invalid") return { error: LINK_INVALID, linkDead: true };
  if (status === "inactive") return { error: ACCOUNT_INACTIVE, linkDead: true };

  const passwordHash = await hashPassword(password);

  let result;
  try {
    result = await redeemResetToken(token, passwordHash, (tx, account) =>
      /*
       * Logged even though there's no session yet: the account holder is the
       * actor, and "who set this password and when" is exactly what the log
       * is for. The payload stands in for the session issued below; the
       * entry reads the actor's name from the account row itself.
       */
      recordAuditInTransaction(
        tx,
        {
          userId: account.id,
          role: account.role,
          denIds: account.denIds,
          scoutIds: account.scoutIds,
          displayName: account.displayName,
          sv: account.sessionVersion,
        },
        {
          action: "user.setOwnPassword",
          summary: `“${account.username}” (${account.displayName}) set their own password from a one-time link`,
          entityType: "User",
          entityId: account.id,
        }
      )
    );
  } catch (error) {
    // The whole change rolled back, link included, so the same link can be
    // tried again.
    console.error("[password reset] saving a new password failed", error);
    return { error: "Your new password couldn't be saved. Please try again in a moment." };
  }

  if (result.status !== "redeemed") {
    return { error: result.status === "inactive" ? ACCOUNT_INACTIVE : LINK_INVALID, linkDead: true };
  }

  // Signed with the session version this change committed, so it's the one
  // live session; anything that bumps the version later revokes it as usual.
  const { account } = result;
  await createSessionCookie({
    userId: account.id,
    role: account.role,
    denIds: account.denIds,
    scoutIds: account.scoutIds,
    displayName: account.displayName,
    sv: account.sessionVersion,
  });

  redirect("/portal");
}
