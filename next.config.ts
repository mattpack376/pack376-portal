import type { NextConfig } from "next";

/**
 * Baseline security response headers, applied to every route.
 *
 * These are the headers that are safe to enforce without a per-request nonce.
 * A full Content-Security-Policy that also restricts script-src/style-src is
 * intentionally NOT set here: the app relies on Next's inline hydration scripts
 * and inline `style={{}}` throughout, and renders arbitrary external cover
 * images in the gallery, so a strict CSP needs a nonce rollout (report-only
 * first) to avoid breakage. The CSP below only locks down the directives that
 * don't break current functionality — clickjacking, base-tag injection, plugin
 * embedding, and form-submission targets.
 */
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
};

export default nextConfig;
