"use client";

import { useEffect } from "react";

/** A restored offset this small is Chrome's toolbar inset (~112px), not where the visitor was reading. */
const MAX_STRAY_OFFSET = 200;

/**
 * Chrome on iPhone counts its toolbars as part of the page, and on a refresh or
 * Back it can restore the page scrolled down by about the toolbar's height — the
 * header ends up under the address bar and can't be scrolled back into view.
 * This puts such a page back at the top, once, unless the visitor has already
 * touched it, followed a #link, or is partway down on purpose. Does nothing in
 * any other browser.
 */
export default function ChromeIosScrollReset() {
  useEffect(() => {
    if (!/CriOS/.test(navigator.userAgent)) return;
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav?.type !== "reload" && nav?.type !== "back_forward") return;
    if (window.location.hash) return;

    let touched = false;
    const onTouch = () => {
      touched = true;
    };
    const resetIfStray = () => {
      if (touched) return;
      if (window.scrollY > 0 && window.scrollY <= MAX_STRAY_OFFSET) {
        // "instant" overrides the page-wide `scroll-behavior: smooth`.
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      }
    };

    window.addEventListener("touchstart", onTouch, { passive: true, once: true });
    window.addEventListener("wheel", onTouch, { passive: true, once: true });
    resetIfStray();
    // Chrome can restore the offset after the page is up, so check again as it settles.
    window.addEventListener("load", resetIfStray, { once: true });
    window.addEventListener("pageshow", resetIfStray, { once: true });
    const timer = window.setTimeout(resetIfStray, 400);
    // The touch/wheel watch stays on until the page is left (each fires once),
    // so a slow page whose load lands after the visitor started scrolling is
    // never yanked back to the top.

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("touchstart", onTouch);
      window.removeEventListener("wheel", onTouch);
      window.removeEventListener("load", resetIfStray);
      window.removeEventListener("pageshow", resetIfStray);
    };
  }, []);

  return null;
}
