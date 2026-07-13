import "server-only";

/** Matches proxy.ts's PORTAL_HOSTS — the canonical host links in emails should point to. */
export function getAppBaseUrl() {
  return process.env.NODE_ENV === "production"
    ? "https://portal.pack376nyc.org"
    : "http://portal.localhost:3000";
}
