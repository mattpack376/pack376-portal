"use client";

import { useEffect, useState } from "react";

/** How far down the page (px) before the button appears — past the hero and the Year at a Glance box. */
const SHOW_AFTER = 600;

/**
 * A round floating button that returns to the top of the page in one tap, for
 * a long page like the calendar. Hidden until the visitor has scrolled down,
 * and out of the tab order while hidden so keyboard users don't land on an
 * invisible control. The page-wide `scroll-behavior: smooth` is skipped for
 * people who've asked their device for less motion.
 */
export default function BackToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > SHOW_AFTER);
    onScroll();
    // Passive: this only reads the scroll position, so the browser needn't wait on it to keep scrolling.
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function backToTop() {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }

  return (
    <button
      type="button"
      className={`back-to-top${visible ? " is-visible" : ""}`}
      aria-label="Back to top"
      tabIndex={visible ? 0 : -1}
      onClick={backToTop}
    >
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    </button>
  );
}
