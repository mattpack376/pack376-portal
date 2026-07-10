"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setMeetingStatusAction } from "@/lib/actions/attendance";

export default function MeetingStatusToggle({
  meetingDateId,
  status,
}: {
  meetingDateId: string;
  status: "SCHEDULED" | "NO_MEETING";
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const cancelled = status === "NO_MEETING";

  function handleClick() {
    const next = cancelled ? "SCHEDULED" : "NO_MEETING";
    const confirmMsg = cancelled
      ? "Reactivate this meeting? Den leaders will be able to take attendance again."
      : "Mark this Friday as No Meeting for the whole pack? Nobody will be able to take attendance for this date.";
    if (!window.confirm(confirmMsg)) return;
    startTransition(async () => {
      await setMeetingStatusAction(meetingDateId, next);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      className={cancelled ? "btn btn-primary btn-small" : "btn btn-red btn-small"}
      onClick={handleClick}
      disabled={isPending}
    >
      {isPending ? "Saving…" : cancelled ? "Reactivate Meeting" : "Mark as No Meeting"}
    </button>
  );
}
