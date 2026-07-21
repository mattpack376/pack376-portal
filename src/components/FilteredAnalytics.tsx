"use client";

import { Analytics } from "@vercel/analytics/next";

/**
 * Passing a function as a prop from the (server) root layout straight to
 * Analytics isn't allowed across the server/client boundary, so the filter
 * lives in this small client wrapper instead.
 */
export default function FilteredAnalytics() {
  return (
    <Analytics
      beforeSend={(event) => {
        // Reset/invite and photo-consent links carry a one-time capability
        // token in the URL — never forward those paths to Vercel Analytics.
        if (/^\/portal\/reset\/|^\/consent\//.test(new URL(event.url).pathname)) return null;
        return event;
      }}
    />
  );
}
