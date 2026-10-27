"use client";

import { useActionState } from "react";
import Image from "next/image";
import { loginAction, type LoginState } from "./actions";
import LoginView from "./LoginView";

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

        <LoginView state={state} formAction={formAction} pending={pending} />
      </div>
    </div>
  );
}
