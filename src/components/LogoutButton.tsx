"use client";

import { logoutAction } from "@/app/portal/actions";

export default function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button type="submit" className="btn btn-outline btn-small" style={{ borderColor: "rgba(255,255,255,0.5)" }}>
        Log Out
      </button>
    </form>
  );
}
