"use client";

import { useEffect, useRef, useState } from "react";
import PortalNav from "@/components/PortalNav";
import LogoutButton from "@/components/LogoutButton";
import { ROLE_LABELS, ROLE_BADGE_CLASSES } from "@/lib/roleLabels";
import type { Role } from "@/generated/prisma/enums";


export default function PortalHeaderNav({
  role,
  displayName,
  hasLinkedScouts = false,
  hasDens = false,
  isMasterAdmin = false,
  isRaffleHelper = false,
}: {
  role: Role;
  displayName: string;
  hasLinkedScouts?: boolean;
  hasDens?: boolean;
  isMasterAdmin?: boolean;
  isRaffleHelper?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const collapsibleRef = useRef<HTMLDivElement>(null);

  // Publish the pinned header's real height as --portal-header-h, so sticky
  // section headings and #anchor jumps sit just below it. It varies with the
  // role's nav (it wraps on narrower desktops), the badge size and the iPhone
  // safe area; offsetHeight includes that safe-area padding. The open phone
  // menu is absolutely positioned, so opening it doesn't change the height.
  useEffect(() => {
    const header = collapsibleRef.current?.closest<HTMLElement>(".portal-header");
    if (!header) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--portal-header-h", `${header.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--portal-header-h");
    };
  }, []);

  return (
    <>
      <button
        className="portal-nav-toggle"
        aria-label="Toggle menu"
        onClick={() => setOpen((v) => !v)}
      >
        &#9776;
      </button>
      <div ref={collapsibleRef} className={`portal-collapsible${open ? " open" : ""}`}>
        <PortalNav
          role={role}
          hasLinkedScouts={hasLinkedScouts}
          hasDens={hasDens}
          isMasterAdmin={isMasterAdmin}
          isRaffleHelper={isRaffleHelper}
          onNavigate={() => setOpen(false)}
        />
        <div className="portal-user">
          <span className={`badge-pill ${ROLE_BADGE_CLASSES[role]}`}>{ROLE_LABELS[role]}</span>
          <span>{displayName}</span>
          <LogoutButton />
        </div>
      </div>
    </>
  );
}
