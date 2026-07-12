"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/parent-resources", label: "Parent Resources" },
  { href: "/leader-resources", label: "Leader Resources" },
  { href: "/den-leaders-corner", label: "Den Leaders' Corner" },
  { href: "/rank-requirements", label: "Rank Requirements" },
  { href: "/gallery", label: "Photo Albums" },
  { href: "/contact", label: "Contact Us" },
];

const EXTERNAL_LINKS = [{ href: "https://www.troop376nyc.org", label: "Troop 376" }];

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
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={pathname === link.href ? "active" : ""}
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          {EXTERNAL_LINKS.map((link) => (
            <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">
              {link.label}
            </a>
          ))}
        </div>
      </nav>
      <div className="string-lights" />
    </header>
  );
}
