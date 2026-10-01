"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeParentAction } from "@/lib/actions/parents";

/** Parent Contacts row: asks before deleting the contact — one stray tap used to remove it outright. */
export default function RemoveParentButton({
  parentId,
  parentName,
  scoutName,
  hasPortalAccess,
}: {
  parentId: string;
  parentName: string;
  scoutName: string;
  hasPortalAccess: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleClick() {
    const portalNote = hasPortalAccess ? ` They'll also lose Parent Portal access to ${scoutName}.` : "";
    if (
      !window.confirm(
        `Remove ${parentName} as a contact for ${scoutName}? Their name, email and phone come off the roster — this can't be undone.${portalNote}`
      )
    )
      return;
    startTransition(async () => {
      const formData = new FormData();
      formData.set("parentId", parentId);
      try {
        await removeParentAction(formData);
        setError(null);
        router.refresh();
      } catch {
        setError("Couldn't remove this contact. Try again.");
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        className="btn btn-danger btn-small"
        style={{ fontSize: 15 }}
        onClick={handleClick}
        disabled={isPending}
      >
        {isPending ? "Removing…" : "Remove"}
      </button>
      {error && <p className="form-error" style={{ marginTop: 4, fontSize: 12 }}>{error}</p>}
    </div>
  );
}
