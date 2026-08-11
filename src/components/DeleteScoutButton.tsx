"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteScoutAction } from "@/lib/actions/scouts";

export default function DeleteScoutButton({ scoutId, scoutName }: { scoutId: string; scoutName: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleClick() {
    if (!window.confirm(`Delete ${scoutName}? This removes their advancement, attendance, dues, and parent contacts too — it can't be undone.`)) return;
    startTransition(async () => {
      const result = await deleteScoutAction(scoutId);
      if (result.ok) {
        setError(null);
        router.push("/portal/admin/users/scouts");
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
        {isPending ? "Deleting…" : "Delete Scout"}
      </button>
      {error && <p className="form-error" style={{ marginTop: 4, fontSize: 12 }}>{error}</p>}
    </div>
  );
}
