"use client";

import { useRef, useState, useSyncExternalStore } from "react";

/*
 * "Share PDF": hands the phone's share sheet the PDF file and nothing else.
 *
 * Download PDF opens the phone's own PDF viewer, and sharing from there also
 * sends the address of the page that opened it — a receipt texted from there
 * arrives with a portal link stuck to it. navigator.share with only `files`
 * (no title, text or url) shares just the file.
 *
 * Only shown where the browser can share files — phones, tablets, Safari on a
 * Mac; elsewhere Download PDF is the way. `getFile` builds the PDF (and does
 * whatever else the caller needs, such as saving it to the history); it
 * returns null after reporting its own error.
 */

function canShareFiles() {
  if (typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [new File([""], "receipt.pdf", { type: "application/pdf" })] });
  } catch {
    return false;
  }
}

const noSubscription = () => () => {};

export default function SharePdfButton({
  getFile,
  className,
  disabled,
}: {
  getFile: () => Promise<File | null>;
  className?: string;
  disabled?: boolean;
}) {
  // Read on the client only — the server can't know, so it renders nothing.
  const supported = useSyncExternalStore(noSubscription, canShareFiles, () => false);
  const [status, setStatus] = useState<"idle" | "preparing" | "ready" | "error">("idle");
  // The PDF once built, so a second tap can share it straight away.
  const fileRef = useRef<File | null>(null);

  // Resolves to false only when the phone refused to open the sheet.
  async function share(file: File) {
    try {
      await navigator.share({ files: [file] });
      setStatus("idle");
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setStatus("idle"); // closed the sheet without sending
        return true;
      }
      return false;
    }
  }

  async function handleClick() {
    if (status === "preparing") return;

    // Second tap: the PDF is ready, share it within this tap.
    if (status === "ready" && fileRef.current) {
      if (!(await share(fileRef.current))) setStatus("error");
      return;
    }

    setStatus("preparing");
    const file = await getFile();
    if (!file) {
      setStatus("idle");
      return;
    }
    fileRef.current = file;
    // Phones only open the share sheet within a moment of the tap, and
    // building the PDF can outlast that. If so, ask for one more tap.
    if (!(await share(file))) setStatus("ready");
  }

  if (!supported) return null;

  return (
    <button
      type="button"
      className={className}
      disabled={disabled || status === "preparing"}
      onClick={handleClick}
      aria-live="polite"
    >
      {status === "preparing"
        ? "Preparing…"
        : status === "ready"
          ? "Tap to Share PDF"
          : status === "error"
            ? "Couldn't Share — Try Again"
            : "Share PDF"}
    </button>
  );
}
