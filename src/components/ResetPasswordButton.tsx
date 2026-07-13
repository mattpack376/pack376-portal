"use client";

import { useState, useTransition } from "react";
import { resetPasswordAction } from "@/lib/actions/users";
import CredentialReveal from "@/components/CredentialReveal";
import type { CreatedInvite } from "@/lib/actions/dens";

export default function ResetPasswordButton({ userId }: { userId: string }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ invite?: CreatedInvite; emailedTo?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    if (!window.confirm("Reset this account's password? The old password will stop working immediately.")) return;
    startTransition(async () => {
      const outcome = await resetPasswordAction(userId);
      if (outcome.ok) {
        setResult(outcome.emailedTo ? { emailedTo: outcome.emailedTo } : { invite: outcome.invite });
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
        style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
        onClick={handleClick}
        disabled={isPending}
      >
        {isPending ? "Resetting…" : "Reset Password"}
      </button>
      {error && <p className="form-error" style={{ marginTop: 8 }}>{error}</p>}
      {result && <CredentialReveal invite={result.invite} emailedTo={result.emailedTo} />}
    </div>
  );
}
