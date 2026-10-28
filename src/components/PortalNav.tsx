"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Role } from "@/generated/prisma/enums";
import { TRIP_SITES } from "@/lib/tripSites";


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
  hasDens = false,
  isMasterAdmin = false,
  isRaffleHelper = false,
  onNavigate,
}: {
  role: Role;
  /** Staff account with a scout linked via Parent.userId — see /portal/my-family. */
  hasLinkedScouts?: boolean;
  /** Has at least one den assignment — gives a Committee Member their den's Family View. */
  hasDens?: boolean;
  /** Master admin (src/lib/masterAdmins.ts) — adds the Audit Log link. */
  isMasterAdmin?: boolean;
  /** Has the per-person Raffle Helper permission — adds the 50/50 Raffles link for levels that don't already have it. */
  isRaffleHelper?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const denId = searchParams.get("denId");
  const withDenId = (href: string) => (denId ? `${href}?denId=${denId}` : href);

  const items: NavItem[] = (() => {
    switch (role) {
      /*
       * Only ADMIN and JUNIOR_ADMIN are grouped. Every other role has few
       * enough links that a flat row is easier to scan than a menu you have
       * to open.
       *
       * Grouping follows what the pages do rather than where they sit in the
       * routes — Dues and Events both track what families owe, Roster and
       * Users are both views of who is in the pack. The exceptions are the
       * one reached often enough that a menu would just be in the way:
       * Family View stays top level even though it'd otherwise sit under
       * People. The event pages (Camp Conron, Cyclones Overnight) share one
       * Trips menu, so the next event is a new entry in it, not a new tab.
       */
      case "ADMIN":
        return [
          { href: "/portal/admin", label: "Dashboard" },
          { href: "/portal/admin/attendance", label: "Attendance" },
          { href: "/portal/roster/family-view", label: "Family View" },
          { label: "Trips", children: TRIP_SITES.map((site) => ({ href: site.adminPath, label: site.navLabel })) },
          {
            label: "People",
            children: [
              { href: "/portal/roster", label: "Roster" },
              { href: "/portal/admin/users", label: "Users" },
              // Admin-only page; contact info for people who never get a login.
              { href: "/portal/admin/attendance/leaders/manage", label: "Committee & Leaders" },
            ],
          },
          {
            label: "Money",
            children: [
              { href: "/portal/admin/dues", label: "Dues" },
              { href: "/portal/admin/events", label: "Events" },
              { href: "/portal/admin/raffles", label: "50/50 Raffles" },
              { href: "/portal/admin/receipts", label: "Receipts" },
              // Admin-only, like Receipts: payments kept when what they were attached to was deleted.
              { href: "/portal/admin/payment-records", label: "Payment Records" },
            ],
          },
          {
            label: "Content",
            children: [
              { href: "/portal/admin/homepage-events", label: "Homepage Content" },
              { href: "/portal/admin/calendar", label: "Calendar" },
              { href: "/portal/admin/parent-portal", label: "Parent Portal" },
              { href: "/portal/admin/albums", label: "Photo Albums" },
            ],
          },
          // Master admin only; the page itself also checks.
          ...(isMasterAdmin ? [{ href: "/portal/admin/audit", label: "Audit Log" }] : []),
        ];
      case "JUNIOR_ADMIN":
        // Same shape as ADMIN minus what they can't reach: Money is
        // read-only for them, Homepage Content is the top banner alone, and
        // there are no event pages (requireTripPageSession turns them away).
        // The calendar is view-only for them, as for every role below Admin.
        return [
          { href: "/portal/admin", label: "Dashboard" },
          { href: "/portal/admin/attendance", label: "Attendance" },
          { href: "/portal/roster/family-view", label: "Family View" },
          // The read-only view of the Committee & Leaders list (an Admin edits
          // it from the Manage page, linked from People for them).
          {
            label: "People",
            children: [
              { href: "/portal/roster", label: "Roster" },
              { href: "/portal/roster/leaders", label: "Committee & Leaders" },
            ],
          },
          {
            label: "Money",
            children: [
              { href: "/portal/admin/dues", label: "Dues" },
              { href: "/portal/admin/events", label: "Events" },
              { href: "/portal/admin/raffles", label: "50/50 Raffles" },
            ],
          },
          { href: "/portal/admin/homepage-events", label: "Top Banner" },
          { href: "/portal/admin/calendar", label: "Calendar" },
        ];
      case "COMMITTEE":
        return [
          { href: "/portal/admin", label: "Dashboard" },
          { href: "/portal/admin/attendance", label: "Attendance" },
          { href: "/portal/admin/dues", label: "Dues" },
          { href: "/portal/roster", label: "Roster" },
          { href: "/portal/roster/leaders", label: "Committee & Leaders" },
          { href: "/portal/admin/calendar", label: "Calendar" },
          { href: "/portal/roster/photo-consent", label: "Photo Consent" },
          // A committee member who also leads a den gets that den's view.
          ...(hasDens ? [{ href: withDenId("/portal/roster/family-view"), label: "Family View" }] : []),
        ];
      case "ATTENDANCE_ADMIN":
        return [
          { href: "/portal/admin/attendance", label: "Attendance" },
          { href: "/portal/roster", label: "Roster" },
          { href: "/portal/roster/leaders", label: "Committee & Leaders" },
          { href: "/portal/admin/calendar", label: "Calendar" },
        ];
      case "PHOTOGRAPHER":
        return [
          { href: "/portal/admin/albums", label: "Photo Albums" },
          { href: "/portal/roster", label: "Roster" },
          { href: "/portal/roster/leaders", label: "Committee & Leaders" },
          { href: "/portal/admin/calendar", label: "Calendar" },
        ];
      case "PARENT":
        return [{ href: "/portal/parent", label: "Dashboard" }];
      case "TRIP_VIEWER":
        return TRIP_SITES.map((site) => ({ href: site.adminPath, label: site.navLabel }));
      default:
        // Preserves the currently selected den (for leaders assigned to more
        // than one) when switching between "My Den" and "Attendance" tabs.
        return [
          { href: withDenId("/portal/den"), label: "My Den" },
          { href: withDenId("/portal/den/attendance"), label: "Attendance" },
          { href: "/portal/roster", label: "Roster" },
          { href: "/portal/roster/leaders", label: "Committee & Leaders" },
          { href: withDenId("/portal/roster/family-view"), label: "Family View" },
          { href: "/portal/admin/calendar", label: "Calendar" },
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

  // Admin and Junior Admin already have the raffles under Money. Anyone else
  // only reaches them with the Raffle Helper permission, so only then do they
  // get the link.
  if (isRaffleHelper && role !== "ADMIN" && role !== "JUNIOR_ADMIN") {
    items.push({ href: "/portal/admin/raffles", label: "50/50 Raffles" });
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
