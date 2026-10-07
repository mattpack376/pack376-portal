"use client";

import { useRef, useState } from "react";
import { saveBlob } from "@/lib/saveFile";

/*
 * "Download PDF" for a PDF built on demand (the receipts).
 *
 * On a phone it opens the share sheet with the PDF and nothing else —
 * Messages, Mail, Save to Files, Print. Saved as a file instead, the PDF opens
 * in the phone's own viewer, and sharing from there also sends a "blob:" line
 * and a link card for the page that opened it; the site can't change what
 * that viewer sends. navigator.share with only `files` (no title, text or
 * url) shares just the file.
 *
 * Anywhere else (a computer, or a phone that can't share files) it downloads
 * as before.
 *
 * `getFile` builds the PDF (and whatever else the caller does with it, such as
 * saving it to the history); it returns null after reporting its own error.
 */

/** A touch device whose browser can hand files to the share sheet. */
function sharesOnTap() {
  if (typeof navigator.canShare !== "function") return false;
  if (!window.matchMedia("(pointer: coarse)").matches) return false;
  try {
    return navigator.canShare({ files: [new File([""], "receipt.pdf", { type: "application/pdf" })] });
  } catch {
    return false;
  }
}

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

  // false only when the phone refused to open the sheet without a fresh tap.
  async function share(file: File) {
    try {
      await navigator.share({ files: [file] });
    } catch (err) {
      if (!(err instanceof DOMException)) throw err;
      if (err.name === "NotAllowedError") return false;
      // AbortError: closed the sheet without sending. Anything else: the sheet
      // couldn't take the file, so fall back to the download.
      if (err.name !== "AbortError") saveBlob(file, file.name);
    }
    return true;
  }

  async function handleClick() {
    if (status === "preparing") return;

    // Second tap: the PDF is built, share it within this tap.
    if (status === "ready" && fileRef.current) {
      const file = fileRef.current;
      if (!(await share(file))) saveBlob(file, file.name);
      setStatus("idle");
      return;
    }

    const mode = sharesOnTap() ? "share" : "download";
    setStatus("preparing");
    const file = await getFile(mode);
    if (!file) return setStatus("idle");

    if (mode === "download") {
      saveBlob(file, file.name);
      return setStatus("idle");
    }
    fileRef.current = file;
    // Phones only open the share sheet within a moment of the tap, and
    // building the PDF can outlast that — if so, ask for one more tap.
    setStatus((await share(file)) ? "idle" : "ready");
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
