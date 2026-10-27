"use client";

import { useActionState, useEffect, useRef } from "react";
import Image from "next/image";
import { loginAction, type LoginState } from "./actions";
import { MAX_PASSWORD_INPUT_LENGTH, MAX_USERNAME_LENGTH } from "@/lib/credentialInput";

const initialState: LoginState = {};
const ERROR_ID = "login-error";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const errorRef = useRef<HTMLDivElement>(null);

  // Every refusal is a new state object, so focus moves to the message each
  // time one comes back, even when it repeats the last one word for word.
  useEffect(() => {
    if (state.error) errorRef.current?.focus();
  }, [state]);

  // A sign-in refusal never says which field was wrong (that would tell a
  // stranger which usernames exist), so the message describes both.
  const invalidProps = state.error ? { "aria-invalid": true, "aria-describedby": ERROR_ID } : {};

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand">
          <Image src="/cub-scout-emblem.png" alt="Pack 376 Cub Scouts emblem" width={48} height={48} />
          <span className="brand-text">
            <span className="pack-name">Pack 376</span>
          </span>
        </div>
        <h1>Portal Login</h1>
        <p className="sub">For Pack 376 families, den leaders &amp; admins.</p>

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
              {...invalidProps}
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
              {...invalidProps}
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={pending}>
            {pending ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
