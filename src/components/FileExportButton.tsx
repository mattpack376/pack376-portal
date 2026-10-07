"use client";

import { useRef, useState } from "react";
import { saveBlob, shareFileOnly, sharesOnTap } from "@/lib/saveFile";

/*
 * A link to a file download (a PDF or CSV export), saved the way the receipt
 * PDFs are: fetched here and handed to the browser as a file (saveBlob), not
 * navigated to. The portal installs as a standalone app, and there a plain
 * link to a file takes over the whole window — full screen, no toolbar,
 * nothing to share or go back with. Saved as a file it opens in the phone's own
 * viewer or save sheet. With JavaScript off it's still an ordinary download
 * link. The filename comes from the response's Content-Disposition, so an
 * export route stays the one place that names its file; a static file in
 * /public has no such header and keeps the name it has in its URL.
 *
 * A PDF on a phone goes to the share sheet instead, with nothing but the file
 * (shareFileOnly in saveFile.ts: the phone's viewer would tack a "blob:" line
 * and a portal link onto anything shared from it). `viewerOnPhone` keeps the
 * viewer — for documents people open to read rather than send.
 */

function filenameFrom(res: Response, href: string) {
  const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "");
  if (match) return match[1];
  const last = new URL(href, window.location.origin).pathname.split("/").pop();
  return last ? decodeURIComponent(last) : "pack376-download";
}

export default function FileExportButton({
  href,
  label,
  className,
  style,
  viewerOnPhone = false,
}: {
  href: string;
  label: string;
  className?: string;
  style?: React.CSSProperties;
  viewerOnPhone?: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  // A PDF already fetched, waiting for the second tap the share sheet asked for.
  const fileRef = useRef<File | null>(null);

  async function onClick(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (status === "loading") return;

    // Second tap: the PDF is here, share it within this tap.
    if (status === "ready" && fileRef.current) {
      const file = fileRef.current;
      if ((await shareFileOnly(file)) === "needs-tap") saveBlob(file, file.name);
      setStatus("idle");
      return;
    }

    setStatus("loading");
    try {
      // Not followed: a redirect here means the session ran out (or the role
      // changed), and following it would "save" the login page as the export —
      // or, in some browsers, just throw. Navigate instead, as the plain link
      // would have, and let the server place them (the login page).
      const res = await fetch(href, { credentials: "same-origin", redirect: "manual" });
      if (res.type === "opaqueredirect") {
        setStatus("idle");
        window.location.assign(href);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const name = filenameFrom(res, href);
      if (!viewerOnPhone && blob.type === "application/pdf" && sharesOnTap(blob.type)) {
        const file = new File([blob], name, { type: blob.type });
        fileRef.current = file;
        // Phones only open the sheet within a moment of the tap, and the
        // fetch can outlast that — if so, ask for one more tap.
        setStatus((await shareFileOnly(file)) === "needs-tap" ? "ready" : "idle");
        return;
      }
      saveBlob(blob, name);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  return (
    // data-file-download: SaveButton's unsaved-changes guard skips it — this saves a file, it doesn't leave the page.
    <a
      href={href}
      className={className}
      style={style}
      onClick={onClick}
      aria-busy={status === "loading"}
      aria-live="polite"
      data-file-download=""
    >
      {status === "loading"
        ? "Preparing…"
        : status === "ready"
          ? "Tap to Share PDF"
          : status === "error"
            ? "Couldn't download — Try Again"
            : label}
    </a>
  );
}
