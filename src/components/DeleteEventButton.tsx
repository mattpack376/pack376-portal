"use client";

import { useTransition } from "react";
import { deleteEventAction } from "@/lib/actions/events";

export default function DeleteEventButton({
  eventId,
  title,
  paymentWarning = "",
}: {
  eventId: string;
  title: string;
  /** paymentDeletionWarning(...) for the event's payments: "" when it has none. */
  paymentWarning?: string;
}) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (
      !window.confirm(
        `Delete "${title}"? This also deletes every scout registration and guest group for it.${paymentWarning} This can't be undone.`,
      )
    ) {
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
      className="btn btn-danger btn-small"
      onClick={handleClick}
      disabled={isPending}
    >
      {isPending ? "Deleting…" : "Delete Event"}
    </button>
  );
}
