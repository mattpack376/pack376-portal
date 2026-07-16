"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

type Role = "ADMIN" | "DEN" | "ATTENDANCE_ADMIN" | "JUNIOR_ADMIN" | "PHOTOGRAPHER" | "PARENT";

/** Public site host (no "portal." prefix) — matches getPublicBaseUrl() in src/lib/appUrl.ts,
 * duplicated here since that helper is server-only and this component is a client component. */
const WEBSITE_URL = "https://pack376nyc.org";

export default function PortalNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const denId = searchParams.get("denId");
  const withDenId = (href: string) => (denId ? `${href}?denId=${denId}` : href);

  const links = (() => {
    switch (role) {
      case "ADMIN":
        return [
          { href: "/portal/admin", label: "Dashboard" },
          { href: "/portal/admin/attendance", label: "Attendance" },
          { href: "/portal/admin/albums", label: "Photo Albums" },
          { href: "/portal/admin/dues", label: "Dues" },
          { href: "/portal/admin/events", label: "Events" },
          { href: "/portal/admin/parent-portal", label: "Parent Portal" },
          { href: "/portal/admin/users", label: "Users" },
          { href: "/portal/roster", label: "Roster" },
        ];
      case "JUNIOR_ADMIN":
        return [
          { href: "/portal/admin", label: "Dashboard" },
          { href: "/portal/admin/attendance", label: "Attendance" },
          { href: "/portal/roster", label: "Roster" },
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
      default:
        // Preserves the currently selected den (for leaders assigned to more
        // than one) when switching between "My Den" and "Attendance" tabs.
        return [
          { href: withDenId("/portal/den"), label: "My Den" },
          { href: withDenId("/portal/den/attendance"), label: "Attendance" },
          { href: "/portal/roster", label: "Roster" },
        ];
    }
  })();

  // Longest matching href wins, so nested routes (e.g. /portal/den/attendance/xyz)
  // highlight "Attendance" and not the shorter "/portal/den" prefix. Compared
  // on path only, since DEN links may carry a `?denId=` query string.
  const activeHref = links
    .filter((link) => {
      const linkPath = link.href.split("?")[0];
      return pathname === linkPath || pathname.startsWith(`${linkPath}/`);
    })
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav className="portal-nav">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={link.href === activeHref ? "active" : ""}
        >
          {link.label}
        </Link>
      ))}
      <a href={WEBSITE_URL} target="_blank" rel="noopener noreferrer">Website</a>
    </nav>
  );
}
