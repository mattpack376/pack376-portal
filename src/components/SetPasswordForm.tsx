"use client";

import { useActionState, useEffect, useRef, type Ref } from "react";
import Link from "next/link";
import { completeResetAction, type CompleteResetState } from "@/lib/actions/passwordReset";
import { DEAD_LINK_TEXT, MAX_PASSWORD_INPUT_LENGTH, MIN_PASSWORD_LENGTH, type DeadLinkReason } from "@/lib/credentialInput";

const initialState: CompleteResetState = {};
const ERROR_ID = "set-password-error";

/**
 * The set-your-password part of the reset page, heading included, so the
 * heading can change along with the rest when a submit finds the link dead.
 */
export default function SetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(completeResetAction, initialState);
  return <SetPasswordView token={token} state={state} formAction={formAction} pending={pending} />;
}

/**
 * What the reset page shows for a link that can't be used: when the page
 * first loads one, and when a submit finds the link spent, expired,
 * superseded or its account inactive. The page and the form use this same
 * view, so the heading never says "Set Your Password" above a dead link.
 */
export function DeadLinkNotice({ reason, alertRef }: { reason: DeadLinkReason; alertRef?: Ref<HTMLDivElement> }) {
  const { heading, message } = DEAD_LINK_TEXT[reason];
  return (
    <>
      <h1>{heading}</h1>
      <div id={ERROR_ID} ref={alertRef} tabIndex={-1} className="form-error" role="alert">
        {message}
      </div>
      <p className="sub">
        <Link href="/portal/login">Go to the sign-in page</Link>
      </p>
    </>
  );
}

/** The form for a given action state; separate from the hook so it can be rendered for any state. */
export function SetPasswordView({
  token,
  state,
  formAction,
  pending,
}: {
  token: string;
  state: CompleteResetState;
  formAction: (formData: FormData) => void;
  pending: boolean;
}) {
  const errorRef = useRef<HTMLDivElement>(null);

  // Every refusal is a new state object, so focus moves to the message each
  // time one comes back, even when it repeats the last one word for word.
  useEffect(() => {
    if (state.error) errorRef.current?.focus();
  }, [state]);

  // The link itself is spent, expired or superseded: another try with this
  // form can't work, so say what will instead of offering the fields again.
  if (state.linkDead) return <DeadLinkNotice reason={state.linkDead} alertRef={errorRef} />;

  const error = state.error ? (
    <div id={ERROR_ID} ref={errorRef} tabIndex={-1} className="form-error" role="alert">
      {state.error}
    </div>
  ) : null;

  // Which field the message is about, so assistive tech reads it with that
  // field. A message about neither (a busy connection, a failed save) is
  // still announced by role="alert".
  const fieldProps = (field: "password" | "confirmPassword") =>
    state.error && state.field === field ? { "aria-invalid": true, "aria-describedby": ERROR_ID } : {};

  return (
    <>
      <h1>Set Your Password</h1>
      <p className="sub">Choose a password for your Pack 376 Portal account.</p>
      {/* The password fields are never refilled after a refusal: React clears
          them when the action returns, and the state carries no password back. */}
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
            maxLength={MAX_PASSWORD_INPUT_LENGTH}
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
            maxLength={MAX_PASSWORD_INPUT_LENGTH}
            required
            {...fieldProps("confirmPassword")}
          />
        </div>
        <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={pending}>
          {pending ? "Saving…" : "Set Password & Sign In"}
        </button>
      </form>
    </>
  );
}
