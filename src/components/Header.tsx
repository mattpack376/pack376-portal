"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/intro-to-scouting", label: "Intro to Scouting" },
  { href: "/volunteer", label: "Volunteer" },
  { href: "/activities", label: "Activities" },
  { href: "https://calendar.pack376nyc.org", label: "Calendar", external: true },
  { href: "/rank-requirements", label: "Rank Requirements" },
  { href: "/parent-resources", label: "Parent Resources" },
  { href: "/den-leaders-corner", label: "Den Leaders' Corner" },
  { href: "/gallery", label: "Photo Albums" },
  { href: "https://www.troop376nyc.org", label: "Troop 376", external: true },
  { href: "/contact", label: "Contact Us" },
  { href: "https://portal.pack376nyc.org", label: "Sign In", external: true },
];

/**
 * `homeHref` lets a page rendered on a different subdomain (e.g. the Camp
 * Conron trip micro-site on conron.pack376nyc.org) point "Home" at the real
 * site homepage instead of "/", which would otherwise just reload that same
 * subdomain's own root. Every other page renders <Header /> with no prop, so
 * "Home" stays a normal same-app "/" link there, unchanged.
 */
export default function Header({ homeHref = "/" }: { homeHref?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const navLinksRef = useRef<HTMLDivElement>(null);
  const isHomeExternal = homeHref !== "/";

  // Belt-and-suspenders against the mobile dropdown opening pre-scrolled to
  // its last item instead of the first (a scroll-anchoring quirk some mobile
  // browsers apply when a display:none -> flex element's overflow container
  // first gets real height) — force it back to the top every time it opens.
  useEffect(() => {
    if (open && navLinksRef.current) {
      navLinksRef.current.scrollTop = 0;
    }
  }, [open]);

  return (
    <header className="site-header">
      <nav className="nav-row">
        <div className="brand">
          <Image
            className="brand-badge"
            src="/cub-scout-emblem.png"
            alt="Pack 376 Cub Scouts emblem"
            width={60}
            height={60}
          />
          <span className="brand-text">
            <span className="pack-name">Pack 376</span>
            <span className="pack-sub">Cub Scouts · Brooklyn</span>
          </span>
        </div>
        <button
          className="nav-toggle"
          aria-label="Toggle menu"
          onClick={() => setOpen((v) => !v)}
        >
          &#9776;
        </button>
        <div ref={navLinksRef} className={`nav-links${open ? " open" : ""}`}>
          {NAV_ITEMS.map((link) => {
            if (link.label === "Home" && isHomeExternal) {
              return (
                <a key="home" href={homeHref} onClick={() => setOpen(false)}>
                  {link.label}
                </a>
              );
            }
            return link.external ? (
              <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">
                {link.label}
              </a>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className={pathname === link.href ? "active" : ""}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="string-lights" />
    </header>
  );
}
