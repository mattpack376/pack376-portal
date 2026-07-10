"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteUserAction } from "@/lib/actions/users";

export default function DeleteUserButton({ userId, username }: { userId: string; username: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleClick() {
    if (!window.confirm(`Delete the account "${username}"? This can't be undone.`)) return;
    startTransition(async () => {
      const result = await deleteUserAction(userId);
      if (result.ok) {
        setError(null);
        router.push("/portal/admin/users");
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
        {isPending ? "Deleting…" : "Delete"}
      </button>
      {error && <p className="form-error" style={{ marginTop: 4, fontSize: 12 }}>{error}</p>}
    </div>
  );
}
