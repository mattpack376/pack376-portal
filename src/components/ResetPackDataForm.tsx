"use client";

import { useActionState, useState } from "react";
import { resetPackDataAction, type ResetState } from "@/lib/actions/reset";
import { resetConfirmationPhrase } from "@/lib/resetConfirmation";

const initialState: ResetState = {};

export default function ResetPackDataForm({ scoutingYears }: { scoutingYears: string[] }) {
  const [state, formAction, pending] = useActionState(resetPackDataAction, initialState);
  const [scoutingYear, setScoutingYear] = useState(scoutingYears[0] ?? "");

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
