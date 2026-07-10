"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { markDenPresentAction } from "@/lib/actions/attendance";

export default function MarkAllPresentButton({
  denId,
  meetingDateId,
}: {
  denId: string;
  meetingDateId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    if (!window.confirm("Mark every scout in this den present for this meeting?")) return;
    startTransition(async () => {
      await markDenPresentAction(denId, meetingDateId);
      router.refresh();
    });
  }

  return (
    <button type="button" className="btn btn-primary btn-small" onClick={handleClick} disabled={isPending}>
      {isPending ? "Marking…" : "Mark All Present"}
    </button>
  );
}
