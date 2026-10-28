import "server-only";
import { checkRateLimit } from "@vercel/firewall";

/**
 * The one Vercel Firewall rate-limit rule every public form checks. The
 * Hobby plan allows a single rate-limit rule, so sign-in, the reset/invite
 * link form and public trip registration all use this one. Each form still
 * counts separately, per IP address: sign-in uses the rule's own per-IP
 * count, and the other two pass their own key (see FORM_KEY_PREFIX), so a
 * family that has just registered for a trip can still sign in.
 *
 * The rule sets the numbers (requests per window) for all three at once.
 * Renaming it here means renaming it in Vercel → Firewall too.
 */
export const RATE_LIMIT_RULE_ID = "portal-login";

export type RateLimitedForm = "login" | "reset" | "trip-registration";

/**
 * Sign-in has no prefix: it keeps the rule's default per-IP count, exactly
 * as before the rule was shared. The others get their own count under the
 * same rule; the firewall hashes the key together with the rule ID, so
 * "reset:1.2.3.4" and plain "1.2.3.4" never share a bucket.
 */
const FORM_KEY_PREFIX: Record<RateLimitedForm, string | null> = {
  login: null,
  reset: "reset",
  "trip-registration": "trip-registration",
};

type HeaderReader = { get(name: string): string | null };

/**
 * The address the firewall counts by. Vercel sets x-real-ip itself on every
 * request it serves (a client can't supply its own), and it's the header the
 * firewall SDK uses for its default key, so all three forms count the same
 * address.
 */
function clientIp(headerList: HeaderReader): string | null {
  const ip = headerList.get("x-real-ip")?.trim();
  return ip ? ip : null;
}

/**
 * True when this form should turn the request away because the visitor's
 * address is over the shared rule's limit.
 *
 * Fails open, on purpose, in two cases: when the rule doesn't exist (a
 * Firewall mistake must not lock every leader out of sign-in) and when the
 * request has no client address to count (never on Vercel). Both log a line
 * that's easy to search for in Vercel → Logs, since otherwise nothing shows
 * the limit isn't working.
 */
export async function isRateLimited(form: RateLimitedForm, headerList: Headers): Promise<boolean> {
  const prefix = FORM_KEY_PREFIX[form];
  let rateLimitKey: string | undefined;
  if (prefix) {
    const ip = clientIp(headerList);
    if (!ip) {
      console.error(`[rate limit] no client address on a ${form} request, so it wasn't counted`);
      return false;
    }
    rateLimitKey = `${prefix}:${ip}`;
  }

  const { rateLimited, error } = await checkRateLimit(
    RATE_LIMIT_RULE_ID,
    rateLimitKey ? { headers: headerList, rateLimitKey } : { headers: headerList },
  );
  if (error === "not-found") {
    console.error(`[rate limit] no "${RATE_LIMIT_RULE_ID}" rule in the Vercel Firewall (checked by ${form})`);
  }
  return rateLimited;
}
