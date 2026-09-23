"use client";

import { Analytics } from "@vercel/analytics/next";

/**
 * Paths that carry a one-time capability token in the URL itself. Anyone
 * holding one of these URLs can set a password or sign a photo consent form
 * without a session, so the URL is the credential — it must never leave the
 * browser in an analytics payload.
 */
const TOKEN_PATH_PREFIXES = ["/reset/", "/consent/"];

/**
 * portal.pack376nyc.org serves the portal at the site root and src/proxy.ts
 * rewrites the missing prefix back on internally — so the same reset link is
 * /portal/reset/<token> on the main domain and /reset/<token> on the portal
 * subdomain. `event.url` is the address bar, not the rewritten internal path,
 * which is why matching only the canonical "/portal/reset/" form let the
 * short alias through with its token intact. Strip the optional prefix first,
 * then match, so both spellings are covered.
 */
function isCapabilityTokenPath(pathname: string): boolean {
  const normalized = pathname.replace(/^\/portal(?=\/|$)/, "") || "/";
  return TOKEN_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Passing a function as a prop from the (server) root layout straight to
 * Analytics isn't allowed across the server/client boundary, so the filter
 * lives in this small client wrapper instead.
 */
export default function FilteredAnalytics() {
  return (
    <Analytics
      beforeSend={(event) => {
        try {
          if (isCapabilityTokenPath(new URL(event.url).pathname)) return null;
        } catch {
          // An unparseable URL is not something to report on — drop it rather
          // than let a parse failure send whatever it was.
          return null;
        }
        return event;
      }}
    />
  );
}
