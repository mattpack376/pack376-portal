"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Role = "ADMIN" | "DEN" | "ATTENDANCE_ADMIN" | "JUNIOR_ADMIN" | "PHOTOGRAPHER" | "PARENT" | "TRIP_VIEWER";

/** Public site host (no "portal." prefix) — matches getPublicBaseUrl() in src/lib/appUrl.ts,
 * duplicated here since that helper is server-only and this component is a client component. */
const WEBSITE_URL = "https://pack376nyc.org";

type NavLink = { href: string; label: string };
type NavGroup = { label: string; children: NavLink[] };
type NavItem = NavLink | NavGroup;

const isGroup = (item: NavItem): item is NavGroup => "children" in item;

export default function PortalNav({
  role,
  hasLinkedScouts = false,
  onNavigate,
}: {
  role: Role;
  /** Staff account with a scout linked via Parent.userId — see /portal/my-family. */
  hasLinkedScouts?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const denId = searchParams.get("denId");
  const withDenId = (href: string) => (denId ? `${href}?denId=${denId}` : href);

  const items: NavItem[] = (() => {
    switch (role) {
      /*
       * Only ADMIN is grouped. Every other role has four links or fewer,
       * where a flat row is easier to scan than a menu you have to open.
       *
       * Grouping follows what the pages do rather than where they sit in the
       * routes — Dues and Events both track what families owe, Roster and
       * Users are both views of who is in the pack. The exceptions are the
       * two reached often enough that a menu would just be in the way:
       * Family View and Camp Conron stay top level even though they'd
       * otherwise sit under People and Money.
       */
      case "ADMIN":
        return [
          { href: "/portal/admin", label: "Dashboard" },
          { href: "/portal/admin/attendance", label: "Attendance" },
          { href: "/portal/roster/family-view", label: "Family View" },
          { href: "/portal/admin/camp-conron", label: "Camp Conron Trip" },
          {
            label: "People",
            children: [
              { href: "/portal/roster", label: "Roster" },
              { href: "/portal/admin/users", label: "Users" },
            ],
          },
          {
            label: "Money",
            children: [
              { href: "/portal/admin/dues", label: "Dues" },
              { href: "/portal/admin/events", label: "Events" },
            ],
          },
          {
            label: "Content",
            children: [
              { href: "/portal/admin/homepage-events", label: "Homepage Content" },
              { href: "/portal/admin/parent-portal", label: "Parent Portal" },
              { href: "/portal/admin/albums", label: "Photo Albums" },
            ],
          },
        ];
      case "JUNIOR_ADMIN":
        return [
          { href: "/portal/admin", label: "Dashboard" },
          { href: "/portal/admin/attendance", label: "Attendance" },
          { href: "/portal/admin/homepage-events", label: "Homepage Content" },
          { href: "/portal/admin/camp-conron", label: "Camp Conron Trip" },
          { href: "/portal/roster", label: "Roster" },
          { href: "/portal/roster/family-view", label: "Family View" },
        ];
      case "ATTENDANCE_ADMIN":
        return [
          { href: "/portal/admin/attendance", label: "Attendance" },
          { href: "/portal/roster", label: "Roster" },
        ];
      case "PHOTOGRAPHER":
        return [
          { href: "/portal/admin/albums", label: "Photo Albums" },
          { href: "/portal/roster", label: "Roster" },
        ];
      case "PARENT":
        return [{ href: "/portal/parent", label: "Dashboard" }];
      case "TRIP_VIEWER":
        return [{ href: "/portal/admin/camp-conron", label: "Camp Conron Trip" }];
      default:
        // Preserves the currently selected den (for leaders assigned to more
        // than one) when switching between "My Den" and "Attendance" tabs.
        return [
          { href: withDenId("/portal/den"), label: "My Den" },
          { href: withDenId("/portal/den/attendance"), label: "Attendance" },
          { href: "/portal/roster", label: "Roster" },
          { href: withDenId("/portal/roster/family-view"), label: "Family View" },
        ];
    }
  })();

  /*
   * Staff who are also parents in the pack get their own child's family view.
   * Appended rather than placed per-role because it applies to every staff
   * role and only when a scout is actually linked. PARENT already has this as
   * its whole dashboard.
   */
  if (hasLinkedScouts && role !== "PARENT") {
    items.push({ href: "/portal/my-family", label: "My Family" });
  }

  // Longest matching href wins, so nested routes (e.g. /portal/den/attendance/xyz)
  // highlight "Attendance" and not the shorter "/portal/den" prefix. Compared
  // on path only, since DEN links may carry a `?denId=` query string.
  const allLinks = items.flatMap((item) => (isGroup(item) ? item.children : [item]));
  const activeHref = allLinks
    .filter((link) => {
      const linkPath = link.href.split("?")[0];
      return pathname === linkPath || pathname.startsWith(`${linkPath}/`);
    })
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  // Close an open menu on outside click or Escape. Only bound while one is
  // open, so the usual case costs no listeners.
  useEffect(() => {
    if (!openGroup) return;
    const onPointerDown = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenGroup(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenGroup(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openGroup]);

  const handleNavigate = () => {
    setOpenGroup(null);
    onNavigate?.();
  };

  return (
    <nav className="portal-nav" ref={navRef}>
      {items.map((item) =>
        isGroup(item) ? (
          <div
            key={item.label}
            className={`portal-nav-group${openGroup === item.label ? " open" : ""}`}
          >
            <button
              type="button"
              aria-expanded={openGroup === item.label}
              className={item.children.some((c) => c.href === activeHref) ? "active" : ""}
              onClick={() => setOpenGroup((v) => (v === item.label ? null : item.label))}
            >
              {item.label}
            </button>
            {/*
              Always rendered, shown or hidden by CSS: below 820px the whole
              header is already behind a hamburger, where these become plain
              labelled sections rather than menus nested inside a menu.
            */}
            <div className="portal-nav-menu">
              {item.children.map((child) => (
                <Link
                  key={child.href}
                  href={child.href}
                  className={child.href === activeHref ? "active" : ""}
                  onClick={handleNavigate}
                >
                  {child.label}
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <Link
            key={item.href}
            href={item.href}
            className={item.href === activeHref ? "active" : ""}
            onClick={handleNavigate}
          >
            {item.label}
          </Link>
        ),
      )}
      <a href={WEBSITE_URL} target="_blank" rel="noopener noreferrer" onClick={handleNavigate}>
        Website
      </a>
    </nav>
  );
}
