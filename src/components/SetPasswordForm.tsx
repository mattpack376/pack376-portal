"use client";

import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import { completeResetAction, type CompleteResetState } from "@/lib/actions/passwordReset";
import { MIN_PASSWORD_LENGTH } from "@/lib/credentialInput";

const initialState: CompleteResetState = {};
const ERROR_ID = "set-password-error";

export default function SetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(completeResetAction, initialState);
  const errorRef = useRef<HTMLDivElement>(null);

  // Every refusal is a new state object, so focus moves to the message each
  // time one comes back, even when it repeats the last one word for word.
  useEffect(() => {
    if (state.error) errorRef.current?.focus();
  }, [state]);

  const error = state.error ? (
    <div id={ERROR_ID} ref={errorRef} tabIndex={-1} className="form-error" role="alert">
      {state.error}
    </div>
  ) : null;

  // The link itself is spent, expired or superseded: another try with this
  // form can't work, so say what will instead of offering the fields again.
  if (state.linkDead) {
    return (
      <>
        {error}
        <p className="sub">
          <Link href="/portal/login">Go to the sign-in page</Link>
        </p>
      </>
    );
  }

  // Which field the message is about, so assistive tech reads it with that
  // field. A message about neither (a busy connection, a failed save) is
  // still announced by role="alert".
  const fieldProps = (field: "password" | "confirmPassword") =>
    state.error && state.field === field ? { "aria-invalid": true, "aria-describedby": ERROR_ID } : {};

  return (
    // The password fields are never refilled after a refusal: React clears
    // them when the action returns, and the state carries no password back.
    <form action={formAction}>
      <input type="hidden" name="token" value={token} />
      {error}
      <div className="form-field">
        <label htmlFor="password">New Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          {...fieldProps("password")}
        />
      </div>
      <div className="form-field">
        <label htmlFor="confirmPassword">Confirm Password</label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          {...fieldProps("confirmPassword")}
        />
      </div>
      <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={pending}>
        {pending ? "Saving…" : "Set Password & Sign In"}
      </button>
    </form>
  );
}
