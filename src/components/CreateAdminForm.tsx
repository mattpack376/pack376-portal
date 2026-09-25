"use client";

import { useState, useTransition } from "react";
import { createAdminAction } from "@/lib/actions/users";
import { ASSIGNABLE_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type AssignableRole } from "@/lib/roleLabels";
import CredentialReveal from "@/components/CredentialReveal";
import type { CreatedInvite } from "@/lib/actions/dens";

export default function CreateAdminForm({ canCreateAdmins }: { canCreateAdmins: boolean }) {
  // Only the master admin can create Admin accounts (see assertCanGrantRole).
  const roles = ASSIGNABLE_ROLES.filter((r) => r !== "ADMIN" || canCreateAdmins);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableRole>(roles[0]);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ invite?: CreatedInvite; emailedTo?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const outcome = await createAdminAction(username, displayName, role, email);
      if (outcome.ok) {
        setResult(outcome.emailedTo ? { emailedTo: outcome.emailedTo } : { invite: outcome.invite });
        setError(null);
        setUsername("");
        setDisplayName("");
        setEmail("");
        setRole(roles[0]);
      } else {
        setError(outcome.error || "Something went wrong.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-field">
        <label htmlFor="new-admin-username">Username</label>
        <input id="new-admin-username" value={username} onChange={(e) => setUsername(e.target.value)} required />
      </div>
      <div className="form-field">
        <label htmlFor="new-admin-name">Display Name</label>
        <input
          id="new-admin-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          placeholder="e.g. Cubmaster Howell Woods"
        />
      </div>
      <div className="form-field">
        <label htmlFor="new-admin-email">Email (optional)</label>
        <input
          id="new-admin-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Emails a setup link instead of showing it on screen"
        />
      </div>
      <div className="form-field">
        <label htmlFor="new-admin-role">Access Level</label>
        <select
          id="new-admin-role"
          value={role}
          onChange={(e) => setRole(e.target.value as AssignableRole)}
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]} — {ROLE_DESCRIPTIONS[r]}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="form-error">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={isPending}>
        {isPending ? "Creating…" : "Create Account"}
      </button>
      {result && <CredentialReveal invite={result.invite} emailedTo={result.emailedTo} />}
    </form>
  );
}
