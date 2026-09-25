"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { markAllAdultLeadersPresentAction } from "@/lib/actions/adultLeaders";

export default function MarkAllLeadersPresentButton({ meetingDateId }: { meetingDateId: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    if (!window.confirm("Mark every leader and committee member present for this meeting?")) return;
    startTransition(async () => {
      await markAllAdultLeadersPresentAction(meetingDateId);
      router.refresh();
    });
  }

  return (
    <button type="button" className="btn btn-primary btn-small" onClick={handleClick} disabled={isPending}>
      {isPending ? "Marking…" : "Mark All Present"}
    </button>
  );
}
