"use client";

import { useState } from "react";
import { saveBlob } from "@/lib/saveFile";

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
}: {
  href: string;
  label: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function onClick(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (status === "loading") return;
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
      saveBlob(await res.blob(), filenameFrom(res, href));
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  return (
    <a href={href} className={className} style={style} onClick={onClick} aria-busy={status === "loading"} aria-live="polite">
      {status === "loading" ? "Preparing…" : status === "error" ? "Couldn't download — Try Again" : label}
    </a>
  );
}
