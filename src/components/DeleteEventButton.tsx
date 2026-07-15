"use client";

import { useTransition } from "react";
import { deleteEventAction } from "@/lib/actions/events";

export default function DeleteEventButton({ eventId, title }: { eventId: string; title: string }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!window.confirm(`Delete "${title}"? This also deletes every scout's registration and payment history for it. This can't be undone.`)) {
      return;
    }
    const formData = new FormData();
    formData.set("id", eventId);
    startTransition(() => {
      deleteEventAction(formData);
    });
  }

  return (
    <button
      type="button"
      className="btn btn-outline btn-small"
      style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}
      onClick={handleClick}
      disabled={isPending}
    >
      {isPending ? "Deleting…" : "Delete Event"}
    </button>
  );
}
