"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { resetPackDataAction, type ResetState } from "@/lib/actions/reset";
import { resetConfirmationPhrase } from "@/lib/resetConfirmation";

const initialState: ResetState = {};

export default function ResetPackDataForm({ scoutingYears }: { scoutingYears: string[] }) {
  const [state, formAction, pending] = useActionState(resetPackDataAction, initialState);
  const [scoutingYear, setScoutingYear] = useState(scoutingYears[0] ?? "");
  const selectRef = useRef<HTMLSelectElement>(null);

  /*
   * Keeps the dropdown showing the year this form is actually about.
   *
   * React resets a form on every submit through an action, and a reset
   * restores each <select> from its options' `selected` attributes. For a
   * *controlled* select React only ever sets the property, so there is no
   * attribute to restore — unless the node came from server-rendered HTML.
   * The admin dashboard links here with <Link>, so it usually doesn't: after
   * a rejected confirmation the box silently dropped back to the first year
   * in the list while the phrase to type and the red button underneath still
   * named the year that was picked. Re-asserting the value after each render
   * keeps the box, the confirmation phrase and the year that actually gets
   * submitted talking about the same season, which on the one irreversible
   * form in the portal is worth an effect.
   */
  useEffect(() => {
    if (selectRef.current && selectRef.current.value !== scoutingYear) {
      selectRef.current.value = scoutingYear;
    }
  });

  if (state?.deletedCount !== undefined) {
    return (
      <p style={{ color: "var(--teal)", fontWeight: 700, marginBottom: 0 }}>
        Done — {state.deletedCount} scout{state.deletedCount === 1 ? "" : "s"} removed from{" "}
        {state.scoutingYear}. That year&apos;s rosters are clean.
      </p>
    );
  }

  if (scoutingYears.length === 0) {
    return <p style={{ marginBottom: 0 }}>No scouting years exist yet.</p>;
  }

  return (
    <form action={formAction}>
      <div className="form-field">
        <label htmlFor="scoutingYear">Scouting Year to Reset</label>
        <select
          id="scoutingYear"
          name="scoutingYear"
          ref={selectRef}
          value={scoutingYear}
          onChange={(e) => setScoutingYear(e.target.value)}
        >
          {scoutingYears.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>
      <div className="form-field">
        <label htmlFor="confirmation">
          Type <code>{resetConfirmationPhrase(scoutingYear)}</code> to confirm
        </label>
        <input id="confirmation" name="confirmation" type="text" required autoComplete="off" />
      </div>
      {state?.error && <p className="form-error">{state.error}</p>}
      <button type="submit" className="btn btn-red" disabled={pending}>
        {pending ? "Deleting…" : `Permanently Delete ${scoutingYear} Scouts`}
      </button>
    </form>
  );
}
