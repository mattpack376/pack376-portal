"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function PortalNav({ role }: { role: "ADMIN" | "DEN" }) {
  const pathname = usePathname();
  const links =
    role === "ADMIN"
      ? [
          { href: "/portal/admin", label: "Dashboard" },
          { href: "/portal/admin/users", label: "Users" },
        ]
      : [{ href: "/portal/den", label: "My Den" }];

  return (
    <nav className="portal-nav">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={pathname === link.href ? "active" : ""}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
