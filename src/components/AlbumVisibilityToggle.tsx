"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleAlbumVisibilityAction } from "@/lib/actions/albums";

/**
 * Show/Hide for one album on the public gallery. Hiding only takes the
 * listing down; the cover photo's direct link keeps working until the album
 * is deleted.
 */
export default function AlbumVisibilityToggle({
  albumId,
  isVisible,
}: {
  albumId: string;
  isVisible: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await toggleAlbumVisibilityAction(albumId, !isVisible);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-quiet btn-small" style={isVisible ? { borderColor: "var(--ink-soft)", color: "var(--ink-soft)" } : { borderColor: "var(--teal)", color: "var(--teal)" }}
        onClick={handleClick}
        disabled={isPending}
      >
        {isPending ? "Saving…" : isVisible ? "Hide" : "Show"}
      </button>
      {error && (
        <span className="form-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
