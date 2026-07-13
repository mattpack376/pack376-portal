"use client";

import { useActionState } from "react";
import { completeResetAction, type CompleteResetState } from "@/lib/actions/passwordReset";

const initialState: CompleteResetState = {};

export default function SetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(completeResetAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="token" value={token} />
      <div className="form-field">
        <label htmlFor="password">New Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      <div className="form-field">
        <label htmlFor="confirmPassword">Confirm Password</label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      {state?.error && <div className="form-error">{state.error}</div>}
      <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={pending}>
        {pending ? "Saving…" : "Set Password & Sign In"}
      </button>
    </form>
  );
}
