"use client";

import { useState, useTransition } from "react";
import { setAdultLeaderAttendanceAction } from "@/lib/actions/adultLeaders";
import { formatAuditTooltip } from "@/lib/auditTooltip";
import { formatPositions } from "@/lib/adultLeaderSections";

/** AttendanceControl's twin for a leader or committee member — see that component. */
export default function LeaderAttendanceControl({
  adultLeaderId,
  meetingDateId,
  name,
  positions,
  active,
  initialPresent,
  updatedAt,
  updatedByUsername,
}: {
  adultLeaderId: string;
  meetingDateId: string;
  name: string;
  positions: string[];
  /** False for someone since taken off the list — still shown on meetings they were marked for. */
  active: boolean;
  initialPresent: boolean | null;
  updatedAt?: Date | null;
  updatedByUsername?: string | null;
}) {
  const [present, setPresent] = useState<boolean | null>(initialPresent);
  const [isPending, startTransition] = useTransition();

  function handleSet(value: boolean) {
    const prev = present;
    setPresent(value);
    startTransition(async () => {
      const result = await setAdultLeaderAttendanceAction(adultLeaderId, meetingDateId, value);
      if (!result.ok) setPresent(prev);
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
      <div>
        <span className="attendance-name">{name}</span>
        {!active && (
          <span className="badge-pill badge-pending" style={{ marginLeft: 8 }}>
            Removed from list
          </span>
        )}
        {positions.length > 0 && <span className="attendance-detail">{formatPositions(positions)}</span>}
      </div>
      <div className="attendance-buttons">
        <button
          type="button"
          className={`att-btn att-present${present === true ? " active" : ""}`}
          onClick={() => handleSet(true)}
          disabled={isPending}
        >
          Present
        </button>
        <button
          type="button"
          className={`att-btn att-absent${present === false ? " active" : ""}`}
          onClick={() => handleSet(false)}
          disabled={isPending}
        >
          Absent
        </button>
        {present === null && <span className="attendance-unmarked">Not yet marked</span>}
      </div>
    </div>
  );
}
