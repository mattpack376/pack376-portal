"use client";

import { useState } from "react";
import PortalNav from "@/components/PortalNav";
import LogoutButton from "@/components/LogoutButton";
import { ROLE_LABELS, ROLE_BADGE_CLASSES } from "@/lib/roleLabels";

type Role = "ADMIN" | "DEN" | "ATTENDANCE_ADMIN" | "JUNIOR_ADMIN" | "PHOTOGRAPHER" | "PARENT" | "TRIP_VIEWER";

export default function PortalHeaderNav({ role, displayName }: { role: Role; displayName: string }) {
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
        <PortalNav role={role} onNavigate={() => setOpen(false)} />
        <div className="portal-user">
          <span className={`badge-pill ${ROLE_BADGE_CLASSES[role]}`}>{ROLE_LABELS[role]}</span>
          <span>{displayName}</span>
          <LogoutButton />
        </div>
      </div>
    </>
  );
}
