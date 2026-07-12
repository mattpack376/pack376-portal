"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Role = "ADMIN" | "DEN" | "ATTENDANCE_ADMIN" | "JUNIOR_ADMIN" | "PHOTOGRAPHER";

export default function PortalNav({ role }: { role: Role }) {
  const pathname = usePathname();

  const links = (() => {
    switch (role) {
      case "ADMIN":
        return [
          { href: "/portal/admin", label: "Dashboard" },
          { href: "/portal/admin/attendance", label: "Attendance" },
          { href: "/portal/admin/albums", label: "Photo Albums" },
          { href: "/portal/admin/dues", label: "Dues" },
          { href: "/portal/admin/users", label: "Users" },
        ];
      case "JUNIOR_ADMIN":
        return [
          { href: "/portal/admin", label: "Dashboard" },
          { href: "/portal/admin/attendance", label: "Attendance" },
          { href: "/portal/admin/albums", label: "Photo Albums" },
        ];
      case "ATTENDANCE_ADMIN":
        return [{ href: "/portal/admin/attendance", label: "Attendance" }];
      case "PHOTOGRAPHER":
        return [{ href: "/portal/admin/albums", label: "Photo Albums" }];
      default:
        return [
          { href: "/portal/den", label: "My Den" },
          { href: "/portal/den/attendance", label: "Attendance" },
        ];
    }
  })();

  // Longest matching href wins, so nested routes (e.g. /portal/den/attendance/xyz)
  // highlight "Attendance" and not the shorter "/portal/den" prefix.
  const activeHref = links
    .filter((link) => pathname === link.href || pathname.startsWith(`${link.href}/`))
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
    </nav>
  );
}
