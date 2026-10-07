import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { requireSession, homeForRole, isMasterAdminSession } from "@/lib/authorize";
import { getActiveSiteBanner } from "@/lib/siteBannerData";
import PortalHeaderNav from "@/components/PortalHeaderNav";

export default async function AuthedPortalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [session, siteBanner] = await Promise.all([requireSession(), getActiveSiteBanner()]);
  // Only shows the master-admin links in the nav; each of those pages still
  // checks for itself. Returns early without a query for anyone but an ADMIN.
  const isMasterAdmin = await isMasterAdminSession(session);

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
            <PortalHeaderNav
              role={session.role}
              displayName={session.displayName}
              hasLinkedScouts={session.scoutIds.length > 0}
              hasDens={session.denIds.length > 0}
              isMasterAdmin={isMasterAdmin}
            />
          </Suspense>
        </div>
      </header>
      {siteBanner && <div className="site-banner">{siteBanner.message}</div>}
      <main className="portal-main">
        <div className="portal-container">{children}</div>
      </main>
    </div>
  );
}
