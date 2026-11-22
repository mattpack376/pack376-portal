"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { isAndroid, saveBlob, shareableFile, shareFileOnly, sharesOnTap } from "@/lib/saveFile";

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
 * On a phone or tablet the file goes to the share sheet instead — Messages,
 * WhatsApp, Mail, AirDrop, Save to Files / Drive, Print — with nothing but the
 * file (shareFileOnly in saveFile.ts: the phone's viewer would tack a "blob:"
 * line and a portal link onto anything shared from it). PDFs, CSVs and
 * pictures alike; a type the phone can't share is saved as before.
 * `viewerOnPhone` keeps the viewer — for documents people open to read
 * rather than send.
 *
 * Android's share sheet has no plain "save" choice (iPhone's has Save to
 * Files), so on Android a small "Save to phone instead" link sits under the
 * button and downloads the file to the phone's Downloads. It's added after the
 * page loads, so the server render and every other device keep the button
 * alone.
 */

function filenameFrom(res: Response, href: string) {
  const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "");
  if (match) return match[1];
  const last = new URL(href, window.location.origin).pathname.split("/").pop();
  return last ? decodeURIComponent(last) : "pack376-download";
}

/**
 * Fetches the export, or returns null after sending the browser to it: a
 * redirect means the session ran out (or the role changed), and following it
 * here would "save" the login page as the export — or, in some browsers, just
 * throw. Navigating, as the plain link would have, lets the server place them.
 */
async function fetchExport(href: string): Promise<{ blob: Blob; name: string } | null> {
  const res = await fetch(href, { credentials: "same-origin", redirect: "manual" });
  if (res.type === "opaqueredirect") {
    window.location.assign(href);
    return null;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { blob: await res.blob(), name: filenameFrom(res, href) };
}

const noSubscription = () => () => {};

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
  // A file already fetched, waiting for the second tap the share sheet asked for.
  const fileRef = useRef<File | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "loading" | "error">("idle");
  // False on the server and in the first render, so the page hydrates cleanly.
  const offerSave = useSyncExternalStore(
    noSubscription,
    () => !viewerOnPhone && isAndroid() && sharesOnTap("application/pdf"),
    () => false,
  );

  async function onSave(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (saveStatus === "loading") return;
    setSaveStatus("loading");
    try {
      const fetched = await fetchExport(href);
      if (fetched) saveBlob(fetched.blob, fetched.name);
      setSaveStatus("idle");
    } catch {
      setSaveStatus("error");
    }
  }

  async function onClick(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (status === "loading") return;

    // Second tap: the file is here, share it within this tap.
    if (status === "ready" && fileRef.current) {
      const file = fileRef.current;
      if ((await shareFileOnly(file)) === "needs-tap") saveBlob(file, file.name);
      setStatus("idle");
      return;
    }

    setStatus("loading");
    try {
      const fetched = await fetchExport(href);
      if (!fetched) {
        setStatus("idle");
        return;
      }
      const { blob, name } = fetched;
      if (!viewerOnPhone && sharesOnTap(blob.type)) {
        const file = shareableFile(blob, name);
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

  const button = (
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
          ? "Tap Again to Share"
          : status === "error"
            ? "Couldn't download — Try Again"
            : label}
    </a>
  );

  if (!offerSave) return button;
  return (
    <span className="export-save-wrap">
      {button}
      <a href={href} className="export-save-link no-print" onClick={onSave} aria-busy={saveStatus === "loading"} aria-live="polite" data-file-download="">
        {saveStatus === "loading" ? "Saving…" : saveStatus === "error" ? "Couldn't save — Try Again" : "Save to phone instead"}
      </a>
    </span>
  );
}
