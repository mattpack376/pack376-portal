"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/intro-to-scouting", label: "Intro to Scouting" },
  { href: "/volunteer", label: "Volunteer" },
  { href: "/activities", label: "Activities" },
  { href: "/rank-requirements", label: "Rank Requirements" },
  { href: "/parent-resources", label: "Parent Resources" },
  { href: "/leader-resources", label: "Leader Resources" },
  { href: "/den-leaders-corner", label: "Den Leaders' Corner" },
  { href: "/gallery", label: "Photo Albums" },
  { href: "https://www.troop376nyc.org", label: "Troop 376", external: true },
  { href: "/contact", label: "Contact Us" },
  { href: "https://portal.pack376nyc.org", label: "Sign In", external: true },
];

export default function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="site-header">
      <nav className="nav-row">
        <Link className="brand" href="/" onClick={() => setOpen(false)}>
          <Image
            className="brand-badge"
            src="/cub-scout-emblem.png"
            alt="Pack 376 Cub Scouts emblem"
            width={46}
            height={46}
          />
          <span className="brand-text">
            <span className="pack-name">Pack 376</span>
            <span className="pack-sub">Cub Scouts · Brooklyn</span>
          </span>
        </Link>
        <button
          className="nav-toggle"
          aria-label="Toggle menu"
          onClick={() => setOpen((v) => !v)}
        >
          &#9776;
        </button>
        <div className={`nav-links${open ? " open" : ""}`}>
          {NAV_ITEMS.map((link) =>
            link.external ? (
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
            )
          )}
        </div>
      </nav>
      <div className="string-lights" />
    </header>
  );
}
