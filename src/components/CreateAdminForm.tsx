"use client";

import { useState, useTransition } from "react";
import { createAdminAction } from "@/lib/actions/users";
import CredentialReveal from "@/components/CredentialReveal";
import type { CreatedCredential } from "@/lib/actions/dens";

export default function CreateAdminForm() {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isPending, startTransition] = useTransition();
  const [credential, setCredential] = useState<CreatedCredential | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createAdminAction(username, displayName);
      if (result.ok) {
        setCredential(result.credential);
        setError(null);
        setUsername("");
        setDisplayName("");
      } else {
        setError(result.error || "Something went wrong.");
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
      {error && <p className="form-error">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={isPending}>
        {isPending ? "Creating…" : "Create Admin Account"}
      </button>
      {credential && <CredentialReveal credential={credential} />}
    </form>
  );
}
