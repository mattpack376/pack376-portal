"use client";

import { useActionState } from "react";
import Link from "next/link";
import { promoteDenAction, type DenActionState } from "@/lib/actions/dens";
import CredentialReveal from "@/components/CredentialReveal";

const initialState: DenActionState = {};

export default function PromoteDenForm({
  denId,
  fromLabel,
  toLabel,
  suggestedYear,
  suggestedUsername,
}: {
  denId: string;
  fromLabel: string;
  toLabel: string;
  suggestedYear: string;
  suggestedUsername: string;
}) {
  const [state, formAction, pending] = useActionState(promoteDenAction, initialState);

  if (state?.invite) {
    return (
      <div className="info-card" style={{ maxWidth: 480 }}>
        <p>
          {fromLabel} promoted to {toLabel}!
        </p>
        <CredentialReveal invite={state.invite} />
        <Link className="btn btn-primary" href="/portal/admin" style={{ marginTop: 16 }}>
          Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="info-card" style={{ maxWidth: 480 }}>
      <p>
        <strong>{fromLabel}</strong> → <strong>{toLabel}</strong>
      </p>
      <p className="form-note" style={{ marginBottom: 16 }}>
        This copies every scout on the current roster into a brand-new {toLabel} den with fresh, unchecked
        adventures. The current den and its history stay exactly as they are.
      </p>
      <form action={formAction}>
        <input type="hidden" name="denId" value={denId} />
        <div className="form-field">
          <label htmlFor="scoutingYear">New Scouting Year</label>
          <input id="scoutingYear" name="scoutingYear" type="text" defaultValue={suggestedYear} required />
        </div>
        <div className="form-field">
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
            <input type="checkbox" name="createLogin" style={{ width: 18, height: 18 }} defaultChecked />
            Also create the new den&apos;s shared login now
          </label>
        </div>
        <div className="form-field">
          <label htmlFor="username">Username (if creating login)</label>
          <input id="username" name="username" type="text" defaultValue={suggestedUsername} />
        </div>
        {state?.error && <p className="form-error">{state.error}</p>}
        <button type="submit" className="btn btn-red" disabled={pending}>
          {pending ? "Promoting…" : `Promote to ${toLabel}`}
        </button>
      </form>
    </div>
  );
}
