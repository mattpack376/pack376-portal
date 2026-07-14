import "server-only";

/** Matches proxy.ts's PORTAL_HOSTS — the canonical host links in emails should point to. */
export function getAppBaseUrl() {
  return process.env.NODE_ENV === "production"
    ? "https://portal.pack376nyc.org"
    : "http://portal.localhost:3000";
}

/**
 * Public site host (no "portal." prefix) — used for links meant for people
 * who never touch the portal, like a parent's photo-consent link. Same
 * deployment as getAppBaseUrl(), just the other host proxy.ts recognizes.
 */
export function getPublicBaseUrl() {
  return process.env.NODE_ENV === "production" ? "https://pack376nyc.org" : "http://localhost:3000";
}
