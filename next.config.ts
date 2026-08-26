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
 * img-src is scoped to Vercel Blob because PhotoAlbum.coverImageUrl (gallery)
 * now points there — covers are uploaded via createAlbumAction/updateAlbumAction
 * (src/lib/actions/albums.ts) rather than hotlinked from an admin-entered URL.
 */
const isDev = process.env.NODE_ENV === "development";
const BLOB_HOSTNAME = "*.public.blob.vercel-storage.com";

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
      `img-src 'self' https://${BLOB_HOSTNAME} data:`,
      "font-src 'self'",
      `connect-src 'self'${isDev ? " ws:" : ""}`,
      // Contact page embeds a Google Maps iframe (src/app/contact/page.tsx).
      "frame-src 'self' https://www.google.com https://maps.google.com",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: BLOB_HOSTNAME }],
  },
  experimental: {
    serverActions: {
      // Cover photo uploads (src/lib/actions/albums.ts) go through Server Actions
      // as multipart FormData; the 1MB default is too small for a phone photo.
      bodySizeLimit: "8mb",
    },
  },
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
      {
        source: "/:path*",
        has: [{ type: "host", value: "register.pack376nyc.org" }],
        destination:
          "https://docs.google.com/forms/d/e/1FAIpQLSdAwkU9i7Sp7QY33BWRezh4d29tfMfEf4YTZG8xLWoh-8PxZA/viewform",
        permanent: false,
      },
      {
        source: "/leader-resources",
        destination: "/den-leaders-corner",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
