"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { isRateLimited } from "@/lib/rateLimit";
import { hashPassword, createSessionCookie } from "@/lib/auth";
import {
  DEAD_LINK_TEXT,
  isWellFormedResetToken,
  newPasswordProblem,
  oversizePasswordProblem,
  type DeadLinkReason,
} from "@/lib/credentialInput";
import { redeemResetToken, resetLinkStatus } from "@/lib/resetTokens";
import { recordAuditInTransaction } from "@/lib/audit";

export type CompleteResetState = {
  error?: string;
  /** The field the error is about, so the form can mark it. */
  field?: "password" | "confirmPassword";
  /**
   * Set when the link itself can't be used, and why: trying again won't help,
   * a new link will. The form then shows the same view the page shows for a
   * dead link on first load.
   */
  linkDead?: DeadLinkReason;
};

function deadLink(reason: DeadLinkReason): CompleteResetState {
  return { error: DEAD_LINK_TEXT[reason].message, linkDead: reason };
}

/**
 * Redeems a one-time invite/reset link, lets the account holder set their own
 * password, and signs them straight in — mirroring loginAction's session
 * setup. sessionVersion is bumped again here (on top of whatever bumped it
 * when the reset was initiated) so this stays correct even for flows, like
 * new-account invites, that never bumped it in the first place.
 *
 * Anyone can post here, so the order is cheapest first: the firewall, then
 * the token's shape and a hard cap on the password's length, then one indexed
 * read to see the link is live, then the password rules — and only a live
 * link with an acceptable password gets the expensive bcrypt hash. The hash
 * runs with no transaction open; the short transaction in redeemResetToken
 * then rechecks everything under the account's lock, so a newer link or an
 * Admin reset that landed meanwhile wins (see resetTokens.ts).
 */
export async function completeResetAction(
  _prevState: CompleteResetState,
  formData: FormData
): Promise<CompleteResetState> {
  // Before anything else, like loginAction. Counted per IP under the shared
  // Firewall rule, separately from sign-in (see rateLimit.ts). If the rule is
  // missing this is a no-op, so the bounds and the cheap link check below
  // are what keep junk requests from costing a bcrypt hash.
  if (await isRateLimited("reset", await headers())) {
    // Not audited, for the same reason a rate-limited sign-in isn't.
    return { error: "Too many attempts from this connection. Try again in a few minutes." };
  }

  const token = formData.get("token");
  const rawPassword = formData.get("password");
  const rawConfirm = formData.get("confirmPassword");
  // Passwords are taken exactly as typed: no trimming.
  const password = typeof rawPassword === "string" ? rawPassword : "";
  const confirmPassword = typeof rawConfirm === "string" ? rawConfirm : "";

  if (!isWellFormedResetToken(token)) return deadLink("invalid");
  // Junk-sized input goes no further: not even the link lookup sees it.
  const oversize = oversizePasswordProblem(password, confirmPassword);
  if (oversize) return oversize;

  // The link before the password rules: if it's dead, fixing the password
  // can't help, so that's the thing to say first. The lookup reads only the
  // token, and the page itself already makes the same read on every visit.
  const status = await resetLinkStatus(token);
  if (status !== "usable") return deadLink(status);

  const problem = newPasswordProblem(password, confirmPassword);
  if (problem) return problem;

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

  if (result.status !== "redeemed") return deadLink(result.status);

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
