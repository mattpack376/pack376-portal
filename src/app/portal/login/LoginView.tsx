"use client";

import { useEffect, useRef } from "react";
import type { LoginField, LoginState } from "./actions";
import { MAX_PASSWORD_INPUT_LENGTH, MAX_USERNAME_LENGTH } from "@/lib/credentialInput";

const ERROR_ID = "login-error";

/**
 * The sign-in message and form for a given action state; separate from the
 * page's hook so it can be rendered for any state.
 */
export default function LoginView({
  state,
  formAction,
  pending,
}: {
  state: LoginState;
  formAction: (formData: FormData) => void;
  pending: boolean;
}) {
  const errorRef = useRef<HTMLDivElement>(null);

  // Every refusal is a new state object, so focus moves to the message each
  // time one comes back, even when it repeats the last one word for word.
  useEffect(() => {
    if (state.error) errorRef.current?.focus();
  }, [state]);

  // Only the fields the action says the message is about. A wrong username
  // or password marks both (the message never says which); a rate limit,
  // lockout or inactive account marks neither, since nothing typed was
  // wrong. Every message is still announced by role="alert".
  const fieldProps = (field: LoginField) =>
    state.error && state.fields?.includes(field) ? { "aria-invalid": true, "aria-describedby": ERROR_ID } : {};

  return (
    <>
      {state.error && (
        <div id={ERROR_ID} ref={errorRef} tabIndex={-1} className="form-error" role="alert">
          {state.error}
        </div>
      )}

      <form action={formAction}>
        <div className="form-field">
          <label htmlFor="username">Username</label>
          {/* React clears the form when the action returns; defaultValue puts
              the username back after a refusal. The password stays cleared. */}
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            maxLength={MAX_USERNAME_LENGTH}
            defaultValue={state.username ?? ""}
            required
            {...fieldProps("username")}
          />
        </div>
        <div className="form-field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={MAX_PASSWORD_INPUT_LENGTH}
            required
            {...fieldProps("password")}
          />
        </div>
        <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={pending}>
          {pending ? "Signing in…" : "Sign In"}
        </button>
      </form>
    </>
  );
}
