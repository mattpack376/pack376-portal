"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { regeneratePhotoConsentTokenAction } from "@/lib/actions/photoConsent";

export function CopyConsentLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button type="button" onClick={copyLink} className="btn btn-outline btn-small" style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}>
      {copied ? "Copied!" : "Copy Link"}
    </button>
  );
}

export function RegenerateConsentLinkButton({ scoutId, scoutName }: { scoutId: string; scoutName: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    if (
      !window.confirm(
        `Regenerate ${scoutName}'s photo consent link? The old link will stop working — anyone who already has it (e.g. a parent) will need the new one.`
      )
    )
      return;
    startTransition(async () => {
      await regeneratePhotoConsentTokenAction(scoutId);
      router.refresh();
    });
  }

  return (
    <button type="button" onClick={handleClick} disabled={isPending} className="btn btn-outline btn-small" style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}>
      {isPending ? "Regenerating…" : "Regenerate Link"}
    </button>
  );
}
