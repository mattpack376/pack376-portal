"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createDenAction, type DenActionState } from "@/lib/actions/dens";
import { RANK_ORDER, RANK_INFO } from "@/lib/rankConfig";
import CredentialReveal from "@/components/CredentialReveal";

const initialState: DenActionState = {};

export default function NewDenPage() {
  const [state, formAction, pending] = useActionState(createDenAction, initialState);

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Admin</div>
        <h2>Create a New Den</h2>
        <p>Add a den for a rank + scouting year, and optionally set up its shared login right away.</p>
      </div>

      <div className="info-card" style={{ maxWidth: 480 }}>
        {state?.invite ? (
          <>
            <p>Den created!</p>
            <CredentialReveal invite={state.invite} />
            <Link className="btn btn-primary" href="/portal/admin" style={{ marginTop: 16 }}>
              Back to Dashboard
            </Link>
          </>
        ) : (
          <form action={formAction}>
            <div className="form-field">
              <label htmlFor="rank">Rank</label>
              <select id="rank" name="rank" required defaultValue="">
                <option value="" disabled>
                  Select a rank
                </option>
                {RANK_ORDER.map((r) => (
                  <option key={r} value={r}>
                    {RANK_INFO[r].label} ({RANK_INFO[r].grade})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="scoutingYear">Scouting Year</label>
              <input id="scoutingYear" name="scoutingYear" type="text" placeholder="2026-2027" required />
            </div>
            <div className="form-field">
              <label htmlFor="label">Label (only if this rank has more than one den)</label>
              <input id="label" name="label" type="text" placeholder="e.g. A" />
            </div>
            <div className="form-field">
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                <input type="checkbox" name="createLogin" style={{ width: 18, height: 18 }} />
                Also create this den&apos;s shared login now
              </label>
            </div>
            <div className="form-field">
              <label htmlFor="username">Username (if creating login)</label>
              <input id="username" name="username" type="text" placeholder="e.g. wolf2026" />
            </div>
            {state?.error && <p className="form-error">{state.error}</p>}
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Creating…" : "Create Den"}
            </button>
          </form>
        )}
      </div>
    </>
  );
}
