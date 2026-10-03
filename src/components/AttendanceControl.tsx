"use client";

import { useState, useTransition } from "react";
import { setAttendanceAction } from "@/lib/actions/attendance";
import { formatAuditTooltip } from "@/lib/auditTooltip";

export default function AttendanceControl({
  scoutId,
  meetingDateId,
  firstName,
  lastName,
  initialPresent,
  updatedAt,
  updatedByUsername,
  locked = false,
}: {
  scoutId: string;
  meetingDateId: string;
  firstName: string;
  lastName: string;
  initialPresent: boolean | null;
  updatedAt?: Date | null;
  updatedByUsername?: string | null;
  /** Past the lock and not an Admin: shown, but not editable. */
  locked?: boolean;
}) {
  const [present, setPresent] = useState<boolean | null>(initialPresent);
  const [isPending, startTransition] = useTransition();

  function handleSet(value: boolean) {
    const prev = present;
    setPresent(value);
    startTransition(async () => {
      const result = await setAttendanceAction(scoutId, meetingDateId, value);
      if (!result.ok) {
        setPresent(prev);
        // e.g. the lock arrived while this page was open — say so rather than silently undoing the click.
        if ("error" in result && result.error) window.alert(result.error);
      }
    });
  }

  const tooltip = updatedAt
    ? formatAuditTooltip(
        present === true ? "Marked present" : present === false ? "Marked absent" : "Marked",
        updatedAt,
        updatedByUsername ?? null
      )
    : null;

  return (
    <div className="attendance-row audit-hover" data-audit={tooltip ?? undefined}>
      <span className="attendance-name">
        {firstName} {lastName}
      </span>
      <div className={`attendance-buttons${locked ? " att-locked" : ""}`}>
        <button
          type="button"
          className={`att-btn att-present${present === true ? " active" : ""}`}
          onClick={() => handleSet(true)}
          disabled={isPending || locked}
        >
          Present
        </button>
        <button
          type="button"
          className={`att-btn att-absent${present === false ? " active" : ""}`}
          onClick={() => handleSet(false)}
          disabled={isPending || locked}
        >
          Absent
        </button>
        {present === null && <span className="attendance-unmarked">Not yet marked</span>}
      </div>
    </div>
  );
}
