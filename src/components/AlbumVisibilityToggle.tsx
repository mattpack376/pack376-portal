"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleAlbumVisibilityAction } from "@/lib/actions/albums";

export default function AlbumVisibilityToggle({
  albumId,
  isVisible,
}: {
  albumId: string;
  isVisible: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    startTransition(async () => {
      await toggleAlbumVisibilityAction(albumId, !isVisible);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      className="btn btn-outline btn-small"
      style={
        isVisible
          ? { borderColor: "var(--ink-soft)", color: "var(--ink-soft)" }
          : { borderColor: "var(--teal)", color: "var(--teal)" }
      }
      onClick={handleClick}
      disabled={isPending}
    >
      {isPending ? "Saving…" : isVisible ? "Hide" : "Show"}
    </button>
  );
}
