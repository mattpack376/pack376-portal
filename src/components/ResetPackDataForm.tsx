"use client";

import { useActionState } from "react";
import { resetPackDataAction, type ResetState } from "@/lib/actions/reset";
import { RESET_CONFIRMATION_PHRASE } from "@/lib/resetConfirmation";

const initialState: ResetState = {};

export default function ResetPackDataForm() {
  const [state, formAction, pending] = useActionState(resetPackDataAction, initialState);

  if (state?.deletedCount !== undefined) {
    return (
      <p style={{ color: "var(--teal)", fontWeight: 700, marginBottom: 0 }}>
        Done — {state.deletedCount} scout{state.deletedCount === 1 ? "" : "s"} removed. Rosters are clean.
      </p>
    );
  }

  return (
    <form action={formAction}>
      <div className="form-field">
        <label htmlFor="confirmation">
          Type <code>{RESET_CONFIRMATION_PHRASE}</code> to confirm
        </label>
        <input id="confirmation" name="confirmation" type="text" required autoComplete="off" />
      </div>
      {state?.error && <p className="form-error">{state.error}</p>}
      <button type="submit" className="btn btn-red" disabled={pending}>
        {pending ? "Deleting…" : "Permanently Delete All Scouts"}
      </button>
    </form>
  );
}
