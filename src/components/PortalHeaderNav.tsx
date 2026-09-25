"use client";

import { useState } from "react";
import PortalNav from "@/components/PortalNav";
import LogoutButton from "@/components/LogoutButton";
import { ROLE_LABELS, ROLE_BADGE_CLASSES } from "@/lib/roleLabels";
import type { Role } from "@/generated/prisma/enums";


export default function PortalHeaderNav({
  role,
  displayName,
  hasLinkedScouts = false,
  hasDens = false,
}: {
  role: Role;
  displayName: string;
  hasLinkedScouts?: boolean;
  hasDens?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="portal-nav-toggle"
        aria-label="Toggle menu"
        onClick={() => setOpen((v) => !v)}
      >
        &#9776;
      </button>
      <div className={`portal-collapsible${open ? " open" : ""}`}>
        <PortalNav role={role} hasLinkedScouts={hasLinkedScouts} hasDens={hasDens} onNavigate={() => setOpen(false)} />
        <div className="portal-user">
          <span className={`badge-pill ${ROLE_BADGE_CLASSES[role]}`}>{ROLE_LABELS[role]}</span>
          <span>{displayName}</span>
          <LogoutButton />
        </div>
      </div>
    </>
  );
}
