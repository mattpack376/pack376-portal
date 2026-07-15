"use client";

import { useActionState } from "react";
import Image from "next/image";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

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

        {state?.error && <div className="form-error">{state.error}</div>}

        <form action={formAction}>
          <div className="form-field">
            <label htmlFor="username">Username</label>
            <input id="username" name="username" type="text" autoComplete="username" required />
          </div>
          <div className="form-field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={pending}>
            {pending ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
