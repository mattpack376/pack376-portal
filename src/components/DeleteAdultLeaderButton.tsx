"use client";

import { useTransition } from "react";
import { deleteAdultLeaderAction } from "@/lib/actions/adultLeaders";

export default function DeleteAdultLeaderButton({
  adultLeaderId,
  name,
  markCount,
}: {
  adultLeaderId: string;
  name: string;
  markCount: number;
}) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    const history =
      markCount === 0
        ? "They have no attendance marks."
        : `This also deletes their ${markCount} attendance mark${markCount === 1 ? "" : "s"}.`;
    if (!window.confirm(`Permanently delete ${name}? ${history} This can't be undone.`)) return;
    const formData = new FormData();
    formData.set("id", adultLeaderId);
    startTransition(() => {
      deleteAdultLeaderAction(formData);
    });
  }

  return (
    <button type="button" className="btn btn-danger btn-small" onClick={handleClick} disabled={isPending}>
      {isPending ? "Deleting…" : "Delete"}
    </button>
  );
}
