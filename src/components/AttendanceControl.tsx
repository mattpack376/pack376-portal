"use client";

import { useState, useTransition } from "react";
import { setAttendanceAction } from "@/lib/actions/attendance";

export default function AttendanceControl({
  scoutId,
  meetingDateId,
  firstName,
  lastName,
  initialPresent,
  disabled,
}: {
  scoutId: string;
  meetingDateId: string;
  firstName: string;
  lastName: string;
  initialPresent: boolean | null;
  disabled?: boolean;
}) {
  const [present, setPresent] = useState<boolean | null>(initialPresent);
  const [isPending, startTransition] = useTransition();

  function handleSet(value: boolean) {
    if (disabled) return;
    const prev = present;
    setPresent(value);
    startTransition(async () => {
      const result = await setAttendanceAction(scoutId, meetingDateId, value);
      if (!result.ok) setPresent(prev);
    });
  }

  return (
    <div className="attendance-row">
      <span className="attendance-name">
        {firstName} {lastName}
      </span>
      <div className="attendance-buttons">
        <button
          type="button"
          className={`att-btn att-present${present === true ? " active" : ""}`}
          onClick={() => handleSet(true)}
          disabled={disabled || isPending}
        >
          Present
        </button>
        <button
          type="button"
          className={`att-btn att-absent${present === false ? " active" : ""}`}
          onClick={() => handleSet(false)}
          disabled={disabled || isPending}
        >
          Absent
        </button>
        {present === null && <span className="attendance-unmarked">Not yet marked</span>}
      </div>
    </div>
  );
}
