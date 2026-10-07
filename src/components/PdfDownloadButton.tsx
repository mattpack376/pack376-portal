"use client";

import { useRef, useState } from "react";
import { saveBlob, shareFileOnly, sharesOnTap } from "@/lib/saveFile";

/*
 * "Download PDF" for a PDF built on demand (the receipts). On a phone it
 * opens the share sheet with the PDF and nothing else (see shareFileOnly in
 * saveFile.ts for why); anywhere else it downloads.
 *
 * `getFile` builds the PDF (and whatever else the caller does with it, such as
 * saving it to the history); it returns null after reporting its own error.
 */

type Status = "idle" | "preparing" | "ready";

export default function PdfDownloadButton({
  getFile,
  className,
  disabled,
}: {
  getFile: (mode: "share" | "download") => Promise<File | null>;
  className?: string;
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<Status>("idle");
  // The PDF once built, so a second tap can share it straight away.
  const fileRef = useRef<File | null>(null);

  async function handleClick() {
    if (status === "preparing") return;

    // Second tap: the PDF is built, share it within this tap.
    if (status === "ready" && fileRef.current) {
      const file = fileRef.current;
      if ((await shareFileOnly(file)) === "needs-tap") saveBlob(file, file.name);
      setStatus("idle");
      return;
    }

    const mode = sharesOnTap("application/pdf") ? "share" : "download";
    setStatus("preparing");
    const file = await getFile(mode);
    if (!file) return setStatus("idle");

    if (mode === "download") {
      saveBlob(file, file.name);
      return setStatus("idle");
    }
    fileRef.current = file;
    setStatus((await shareFileOnly(file)) === "needs-tap" ? "ready" : "idle");
  }

  return (
    <button
      type="button"
      className={className}
      disabled={disabled || status === "preparing"}
      onClick={handleClick}
      aria-live="polite"
    >
      {status === "preparing" ? "Preparing…" : status === "ready" ? "Tap to Share PDF" : "Download PDF"}
    </button>
  );
}
