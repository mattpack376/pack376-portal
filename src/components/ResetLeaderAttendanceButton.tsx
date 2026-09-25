"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetAdultLeaderAttendanceAction } from "@/lib/actions/adultLeaders";

export default function ResetLeaderAttendanceButton({ meetingDateId }: { meetingDateId: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    if (
      !window.confirm(
        'Reset leader & committee attendance for this day? Everyone goes back to "Not yet marked" for this meeting only.'
      )
    )
      return;
    startTransition(async () => {
      await resetAdultLeaderAttendanceAction(meetingDateId);
      router.refresh();
    });
  }

  return (
    <button type="button" className="btn btn-red btn-small" onClick={handleClick} disabled={isPending}>
      {isPending ? "Resetting…" : "Reset Day"}
    </button>
  );
}
