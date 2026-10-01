"use client";

import { useState } from "react";
import { savePdfBlob } from "@/lib/savePdf";

/*
 * A link to a PDF download, saved the way the receipt PDFs are: fetched here
 * and handed to the browser as a file (savePdfBlob), not navigated to. The
 * portal installs as a standalone app, and there a plain link to a PDF takes
 * over the whole window — full screen, no toolbar, nothing to share or go back
 * with. Saved as a file it opens in the phone's own viewer with its share and
 * save controls. With JavaScript off it's still an ordinary download link.
 */

function filenameFrom(res: Response) {
  const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "");
  return match?.[1] ?? "pack376-parent-contacts.pdf";
}

export default function PdfExportButton({
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
      savePdfBlob(new Blob([await res.blob()], { type: "application/pdf" }), filenameFrom(res));
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  return (
    <a href={href} className={className} onClick={onClick} aria-busy={status === "loading"} aria-live="polite">
      {status === "loading" ? "Preparing PDF…" : status === "error" ? "Couldn't make PDF — Try Again" : label}
    </a>
  );
}
