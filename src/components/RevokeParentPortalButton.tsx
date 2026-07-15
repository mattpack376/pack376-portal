"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { revokeParentPortalAction } from "@/lib/actions/parents";

export default function RevokeParentPortalButton({ parentId }: { parentId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleClick() {
    if (!window.confirm("Revoke this family's Parent Portal access? This deletes their login (any siblings linked to the same account lose access too).")) return;
    startTransition(async () => {
      const outcome = await revokeParentPortalAction(parentId);
      if (outcome.ok) {
        setError(null);
        router.refresh();
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
        style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}
        onClick={handleClick}
        disabled={isPending}
      >
        {isPending ? "Revoking…" : "Revoke Portal Access"}
      </button>
      {error && <p className="form-error" style={{ marginTop: 4, fontSize: 12 }}>{error}</p>}
    </div>
  );
}
