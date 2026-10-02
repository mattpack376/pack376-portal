"use client";

import { useRef } from "react";
import { addDays } from "@/lib/calendarData";

/**
 * A start and end date input pair, for the calendar event form and the regular
 * meeting setting. A client component only so the end date's picker can refuse
 * a day before the start — the one date mistake that's easy to make (typing the
 * dates in the wrong order). The browser's own validation message appears
 * instead of a failed save, which in the portal means a dead error page; the
 * Server Actions check it again as a backstop. Both inputs stay uncontrolled so
 * the form's reset and SaveButton's change-tracking treat them like any other
 * field.
 */
export default function CalendarDateFields({
  idPrefix,
  date,
  endDate,
  startName = "date",
  endName = "endDate",
  startLabel = "Date",
  endLabel = "End date (multi-day events)",
  sameDayOk = false,
  required = false,
}: {
  idPrefix: string;
  date: string | null;
  endDate: string | null;
  startName?: string;
  endName?: string;
  startLabel?: string;
  endLabel?: string;
  /** Whether the end may fall on the start day (a one-day span) or must come after it. */
  sameDayOk?: boolean;
  required?: boolean;
}) {
  const endRef = useRef<HTMLInputElement>(null);
  const earliestEnd = (start: string) => (sameDayOk ? start : addDays(start, 1));

  return (
    <div className="form-row">
      <div className="form-field">
        <label htmlFor={`${idPrefix}-${startName}`}>{startLabel}</label>
        <input
          id={`${idPrefix}-${startName}`}
          name={startName}
          type="date"
          required={required}
          defaultValue={date ?? ""}
          onChange={(e) => {
            if (endRef.current) endRef.current.min = e.target.value ? earliestEnd(e.target.value) : "";
          }}
        />
      </div>
      <div className="form-field">
        <label htmlFor={`${idPrefix}-${endName}`}>{endLabel}</label>
        <input
          id={`${idPrefix}-${endName}`}
          name={endName}
          type="date"
          required={required}
          ref={endRef}
          defaultValue={endDate ?? ""}
          min={date ? earliestEnd(date) : undefined}
        />
      </div>
    </div>
  );
}
