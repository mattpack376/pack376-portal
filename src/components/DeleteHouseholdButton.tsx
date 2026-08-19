"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteHouseholdAction } from "@/lib/actions/households";

export default function DeleteHouseholdButton({ householdId, householdName }: { householdId: string; householdName: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleClick() {
    if (!window.confirm(`Delete "${householdName}"? Scouts and logins in it aren't deleted — they just stop being grouped together.`)) return;
    startTransition(async () => {
      const result = await deleteHouseholdAction(householdId);
      if (result.ok) {
        setError(null);
        router.push("/portal/admin/users/households");
        router.refresh();
      } else {
        setError(result.error || "Something went wrong.");
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        className="btn btn-outline btn-small"
        style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}
        onClick={handleClick}
        disabled={isPending}
      >
        {isPending ? "Deleting…" : "Delete Household"}
      </button>
      {error && <p className="form-error" style={{ marginTop: 4, fontSize: 12 }}>{error}</p>}
    </div>
  );
}
