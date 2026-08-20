"use client";

import { useState, useTransition } from "react";
import { createParentAccountAction } from "@/lib/actions/parents";
import CredentialReveal from "@/components/CredentialReveal";
import type { CreatedInvite } from "@/lib/actions/dens";

export type ScoutOption = { id: string; name: string; den: string };

export default function CreateParentForm({ scouts }: { scouts: ScoutOption[] }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [scoutId, setScoutId] = useState("");
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ invite?: CreatedInvite; emailedTo?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Dens keep roster order (Lion -> Arrow of Light), which the page already
  // sorted them into — grouping here would re-sort them alphabetically.
  const byDen = scouts.reduce<Map<string, ScoutOption[]>>((acc, s) => {
    if (!acc.has(s.den)) acc.set(s.den, []);
    acc.get(s.den)!.push(s);
    return acc;
  }, new Map());

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const outcome = await createParentAccountAction(username, displayName, email, phone, scoutId || undefined);
      if (outcome.ok) {
        setResult(outcome.emailedTo ? { emailedTo: outcome.emailedTo } : { invite: outcome.invite });
        setError(null);
        setUsername("");
        setDisplayName("");
        setEmail("");
        setPhone("");
        setScoutId("");
      } else {
        setError(outcome.error || "Something went wrong.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-field">
        <label htmlFor="new-parent-username">Login</label>
        <input
          id="new-parent-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          placeholder="Usually their email address"
        />
      </div>
      <div className="form-field">
        <label htmlFor="new-parent-name">Display Name</label>
        <input
          id="new-parent-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          placeholder="e.g. Dianaliz Rosen"
        />
      </div>
      <div className="form-row">
        <div className="form-field">
          <label htmlFor="new-parent-email">Email (optional)</label>
          <input
            id="new-parent-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Emails the setup link"
          />
        </div>
        <div className="form-field">
          <label htmlFor="new-parent-phone">Phone (optional)</label>
          <input
            id="new-parent-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(212)555-1234"
          />
        </div>
      </div>
      <div className="form-field">
        <label htmlFor="new-parent-scout">Attach a Scout (optional)</label>
        <select id="new-parent-scout" value={scoutId} onChange={(e) => setScoutId(e.target.value)}>
          <option value="">— Attach later from Manage —</option>
          {[...byDen.entries()].map(([den, group]) => (
            <optgroup key={den} label={den}>
              {group.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="form-note">
          A login with no scout attached signs in to an empty dashboard. Siblings share one login — attach the
          rest from this account&apos;s Manage page.
        </p>
      </div>
      {error && <p className="form-error">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={isPending}>
        {isPending ? "Creating…" : "Create Parent Account"}
      </button>
      {result && <CredentialReveal invite={result.invite} emailedTo={result.emailedTo} />}
    </form>
  );
}
