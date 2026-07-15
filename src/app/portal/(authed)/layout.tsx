import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { requireSession, homeForRole } from "@/lib/authorize";
import { ROLE_LABELS, ROLE_BADGE_CLASSES } from "@/lib/roleLabels";
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
          <Link className="brand" href={homeForRole(session.role)}>
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
          </Link>
          <Suspense fallback={null}>
            <PortalNav role={session.role} />
          </Suspense>
          <div className="portal-user">
            <span className={`badge-pill ${ROLE_BADGE_CLASSES[session.role]}`}>
              {ROLE_LABELS[session.role]}
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
