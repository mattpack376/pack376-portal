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
 * link. The filename comes from the response's Content-Disposition, so the
 * route stays the one place that names its file.
 */

function filenameFrom(res: Response) {
  const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "");
  return match?.[1] ?? "pack376-export";
}

export default function FileExportButton({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function onClick(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (status === "loading") return;
    setStatus("loading");
    try {
      const res = await fetch(href, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      saveBlob(await res.blob(), filenameFrom(res));
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  return (
    <a href={href} className={className} onClick={onClick} aria-busy={status === "loading"} aria-live="polite">
      {status === "loading" ? "Preparing…" : status === "error" ? "Couldn't export — Try Again" : label}
    </a>
  );
}
