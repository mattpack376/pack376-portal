import Image from "next/image";
import { requireSession } from "@/lib/authorize";
import PortalNav from "@/components/PortalNav";
import LogoutButton from "@/components/LogoutButton";

export default async function AuthedPortalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireSession();

  return (
    <div className="portal-shell">
      <header className="portal-header">
        <div className="portal-header-row">
          <div className="brand">
            <Image
              className="brand-badge"
              src="/cub-scout-emblem.png"
              alt="Pack 376 Cub Scouts emblem"
              width={40}
              height={40}
            />
            <span className="brand-text">
              <span className="pack-name">Pack 376 Portal</span>
            </span>
          </div>
          <PortalNav role={session.role} />
          <div className="portal-user">
            <span className={`badge-pill ${session.role === "ADMIN" ? "badge-admin" : "badge-den"}`}>
              {session.role === "ADMIN" ? "Admin" : "Den Leader"}
            </span>
            <span>{session.displayName}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="portal-main">
        <div className="portal-container">{children}</div>
      </main>
    </div>
  );
}
