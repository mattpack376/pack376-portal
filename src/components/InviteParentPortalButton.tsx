"use client";

import { useState, useTransition } from "react";
import { inviteParentPortalAction } from "@/lib/actions/parents";
import CredentialReveal from "@/components/CredentialReveal";
import type { CreatedInvite } from "@/lib/actions/dens";

export default function InviteParentPortalButton({ parentId, hasEmail }: { parentId: string; hasEmail: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ invite?: CreatedInvite; emailedTo?: string; linkedExisting?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    startTransition(async () => {
      const outcome = await inviteParentPortalAction(parentId);
      if (outcome.ok) {
        setResult({ invite: outcome.invite, emailedTo: outcome.emailedTo, linkedExisting: outcome.linkedExisting });
        setError(null);
      } else {
        setError(outcome.error || "Something went wrong.");
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        className="btn btn-outline btn-small"
        style={{ borderColor: "var(--scout-gold-dark)", color: "var(--scout-gold-dark)" }}
        onClick={handleClick}
        disabled={isPending || !hasEmail}
        title={hasEmail ? undefined : "Add an email to invite this parent"}
      >
        {isPending ? "Inviting…" : "Invite to Parent Portal"}
      </button>
      {error && <p className="form-error" style={{ marginTop: 8 }}>{error}</p>}
      {result?.linkedExisting && (
        <div className="info-card" style={{ borderLeft: "6px solid var(--teal)", marginTop: 8 }}>
          <p style={{ marginBottom: 0, fontWeight: 700, color: "var(--scout-blue-dark)" }}>
            Linked to an existing Parent Portal account for that email.
          </p>
        </div>
      )}
      {(result?.invite || result?.emailedTo) && (
        <CredentialReveal invite={result.invite} emailedTo={result.emailedTo} />
      )}
    </div>
  );
}
