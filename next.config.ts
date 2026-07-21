import type { NextConfig } from "next";

/**
 * Baseline security response headers, applied to every route.
 *
 * The CSP below locks down default-src/img-src/connect-src/font-src to
 * same-origin, closing off arbitrary-origin image loads, fetch/XHR
 * exfiltration, and font loads if an XSS ever landed. script-src and
 * style-src still need 'unsafe-inline': the app relies on Next's inline
 * hydration scripts and inline `style={{}}` throughout, and removing it
 * requires a per-request nonce (see the Nonces section of Next's CSP guide,
 * node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
 * That in turn forces every page to render dynamically — this app's public
 * marketing pages are statically prerendered (see `next build` output), so
 * that tradeoff needs its own decision rather than folding it in here.
 * img-src allows any https origin because PhotoAlbum.coverImageUrl (gallery)
 * is an admin-entered external URL, same trust level as the album link itself.
 */
const isDev = process.env.NODE_ENV === "development";

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // 'unsafe-eval' and the ws: connect-src are dev-only, for React Refresh
      // and the Turbopack/webpack HMR socket — neither exists in production.
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' https: data:",
      "font-src 'self'",
      `connect-src 'self'${isDev ? " ws:" : ""}`,
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "calendar.pack376nyc.org" }],
        destination:
          "https://docs.google.com/document/d/e/2PACX-1vTt7ZYfxypgB9-HXM7inLi7vznfwXyszYWvKKrSrPmCPfoa1CJzaxnBweqPetUUuC7Bz6J7KeItwDc9/pub",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
