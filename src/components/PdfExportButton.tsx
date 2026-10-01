"use client";

import { useRef, useState } from "react";

/*
 * A link to a PDF download. On a phone it opens the share sheet instead.
 *
 * The portal installs as a standalone app (manifest display: "standalone"),
 * and there a plain link to a PDF navigates the whole app window to the PDF —
 * full screen, no toolbar, nothing to share or go back with. So where the
 * device can share files (a touch phone or tablet), fetch the PDF here and
 * hand it to navigator.share: Save to Files, Mail, Messages, AirDrop. Anywhere
 * else it's an ordinary download link, which is also what you get with
 * JavaScript off.
 */

function canShareFiles() {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
  if (!window.matchMedia("(pointer: coarse)").matches) return false;
  try {
    return navigator.canShare({ files: [new File([], "x.pdf", { type: "application/pdf" })] });
  } catch {
    return false;
  }
}

function filenameFrom(res: Response) {
  const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "");
  return match?.[1] ?? "pack376-parent-contacts.pdf";
}

type Status = "idle" | "loading" | "ready" | "error";

export default function PdfExportButton({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  // The fetched PDF, kept once it's in hand so a second tap can share it.
  const fileRef = useRef<File | null>(null);

  // Must run straight from a tap: the share sheet is refused without one.
  async function share(file: File) {
    try {
      await navigator.share({ files: [file], title: file.name });
      setStatus("idle");
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setStatus("idle"); // closed the sheet without choosing anything
        return true;
      }
      return false;
    }
  }

  async function onClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (status === "loading") {
      event.preventDefault();
      return;
    }

    // Second tap, with the PDF already fetched.
    if (status === "ready" && fileRef.current) {
      event.preventDefault();
      if (!(await share(fileRef.current))) window.location.assign(href);
      return;
    }

    if (!canShareFiles()) return; // let the link download as usual

    event.preventDefault();
    setStatus("loading");
    try {
      const res = await fetch(href, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const file = new File([await res.blob()], filenameFrom(res), { type: "application/pdf" });
      fileRef.current = file;
      // Some phones only allow sharing within a moment of the tap, and the
      // fetch can outlast that. If so, ask for a second tap rather than fail.
      if (!(await share(file))) setStatus("ready");
    } catch {
      setStatus("error");
    }
  }

  const text =
    status === "loading"
      ? "Preparing PDF…"
      : status === "ready"
        ? "Tap to Share PDF"
        : status === "error"
          ? "Couldn't make PDF — Try Again"
          : label;

  return (
    <a
      href={href}
      className={className}
      onClick={onClick}
      aria-busy={status === "loading"}
      aria-live="polite"
    >
      {text}
    </a>
  );
}
