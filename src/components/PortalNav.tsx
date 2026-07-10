"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function PortalNav({ role }: { role: "ADMIN" | "DEN" | "ATTENDANCE_ADMIN" }) {
  const pathname = usePathname();
  const links =
    role === "ADMIN"
      ? [
          { href: "/portal/admin", label: "Dashboard" },
          { href: "/portal/admin/attendance", label: "Attendance" },
          { href: "/portal/admin/albums", label: "Photo Albums" },
          { href: "/portal/admin/users", label: "Users" },
        ]
      : role === "ATTENDANCE_ADMIN"
      ? [{ href: "/portal/admin/attendance", label: "Attendance" }]
      : [
          { href: "/portal/den", label: "My Den" },
          { href: "/portal/den/attendance", label: "Attendance" },
        ];

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
