"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetDenAttendanceAction } from "@/lib/actions/attendance";

export default function ResetDenAttendanceButton({
  denId,
  meetingDateId,
  denName,
}: {
  denId: string;
  meetingDateId: string;
  denName: string;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    if (
      !window.confirm(
        `Reset attendance for ${denName} on this day? Every scout in this den goes back to "Not yet marked" for this meeting only.`
      )
    )
      return;
    startTransition(async () => {
      await resetDenAttendanceAction(denId, meetingDateId);
      router.refresh();
    });
  }

  return (
    <button type="button" className="btn btn-red btn-small" onClick={handleClick} disabled={isPending}>
      {isPending ? "Resetting…" : "Reset Day"}
    </button>
  );
}
