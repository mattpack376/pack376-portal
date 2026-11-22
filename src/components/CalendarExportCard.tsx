"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { monthTitle } from "@/lib/calendarData";
import { exportFileName, type ExportFormat } from "@/lib/calendarExport";
import { saveBlob, shareableFile, shareFileOnly, sharesOnTap } from "@/lib/saveFile";

/*
 * "Download or Share", on the portal Calendar page for Admin, Junior Admin and
 * Den Leaders (canExportCalendar): pick a month (or the full year) and PDF or
 * picture, then download it, or on a phone hand it straight to the share
 * sheet (text, WhatsApp, email). The files come from
 * src/app/api/calendar/export/[file], which checks the sign-in itself.
 *
 * Sharing a file needs the file in hand at the moment of the tap — iPhone
 * Safari refuses navigator.share once the tap is more than a moment old, so
 * waiting for a download first would fail. On a device that can share files,
 * the card therefore fetches the selected file once it scrolls into view (and
 * again for each new choice), and Share uses that copy — one small file,
 * cached by the server. If it isn't ready yet, Share fetches it and asks for
 * one more tap.
 */

/**
 * Share is offered on phones and tablets only — the same rule as every other
 * export (sharesOnTap in saveFile.ts). Mac Safari can share files too, but its
 * share sheet comes up empty for a file on its own, and on a computer Download
 * already does the job.
 */
const browserCanShareFiles = () => sharesOnTap("image/png");
const noSubscription = () => () => {};

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "pdf", label: "PDF (best for printing)" },
  { value: "png", label: "Picture (PNG, best for texting)" },
];

export default function CalendarExportCard({
  months,
  yearLabel,
  defaultScope,
}: {
  /** The month keys the calendar has a section for. */
  months: string[];
  yearLabel: string;
  /** "full" or a month key. */
  defaultScope: string;
}) {
  const id = useId();
  const [scope, setScope] = useState(defaultScope);
  const [format, setFormat] = useState<ExportFormat>("pdf");
  // False on the server and in the first render, so the page hydrates cleanly.
  const shareSupported = useSyncExternalStore(noSubscription, browserCanShareFiles, () => false);
  const canShare = shareSupported;
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const engaged = useRef(false);
  const card = useRef<HTMLDivElement>(null);
  const files = useRef(new Map<string, File>());
  const pending = useRef(new Map<string, Promise<File>>());

  const fileName = exportFileName(scope, format, yearLabel);
  const href = `/api/calendar/export/${fileName}`;

  function load(name: string, url: string): Promise<File> {
    const existing = pending.current.get(name);
    if (existing) return existing;
    const promise = fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const file = blob.type
          ? shareableFile(blob, name)
          : new File([blob], name, { type: name.endsWith(".pdf") ? "application/pdf" : "image/png" });
        files.current.set(name, file);
        return file;
      })
      .catch((error) => {
        pending.current.delete(name);
        throw error;
      });
    pending.current.set(name, promise);
    return promise;
  }

  // Get the chosen file ready once the visitor starts using the card.
  useEffect(() => {
    if (canShare && engaged.current) load(fileName, href).catch(() => {});
  }, [canShare, fileName, href]);

  function engage() {
    if (engaged.current || !canShare) return;
    engaged.current = true;
    load(fileName, href).catch(() => {});
  }

  // Coming into view counts as starting to use the card.
  useEffect(() => {
    const el = card.current;
    if (!canShare || !el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        engage();
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- engage reads refs; run once sharing is known
  }, [canShare]);

  // Saved as an in-page file, not followed as a link: in the installed
  // home-screen app a link to a file takes over the whole window (see
  // FileExportButton). With JavaScript off it's still a plain download link.
  async function download(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (busy) return;
    setStatus("");
    setBusy(true);
    try {
      const file = files.current.get(fileName) ?? (await load(fileName, href));
      saveBlob(file, file.name);
    } catch {
      setStatus("The file couldn't be loaded. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    setStatus("");
    const ready = files.current.get(fileName);
    if (ready) {
      // Only the file: a title or text would arrive in Messages as an extra line.
      if ((await shareFileOnly(ready)) === "needs-tap") setStatus("Ready. Tap Share again to send it.");
      return;
    }
    setBusy(true);
    setStatus("Getting the file ready…");
    try {
      await load(fileName, href);
      setStatus("Ready. Tap Share again to send it.");
    } catch {
      setStatus("The file couldn't be loaded. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cal-export" ref={card} onPointerDown={engage} onFocus={engage}>
      <div className="cal-export-head">
        <span className="cal-export-icon" aria-hidden="true">
          🖨️
        </span>
        <div>
          <h3>Download or Share</h3>
          <p>Save a month or the whole year as a PDF to print, or a picture to text to family.</p>
        </div>
      </div>
      <div className="form-field cal-export-which">
        <label htmlFor={`${id}-scope`}>Which part</label>
        <select
          id={`${id}-scope`}
          value={scope}
          onChange={(e) => {
            setScope(e.target.value);
            setStatus("");
          }}
        >
          <option value="full">Full calendar ({yearLabel})</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthTitle(m)}
            </option>
          ))}
        </select>
      </div>
      <div className="form-field cal-export-format">
        <label htmlFor={`${id}-format`}>Format</label>
        <select
          id={`${id}-format`}
          value={format}
          onChange={(e) => {
            setFormat(e.target.value as ExportFormat);
            setStatus("");
          }}
        >
          {FORMATS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      <div className="cal-export-actions">
        <a className="btn btn-primary" href={href} download={fileName} onClick={download} aria-busy={busy} data-file-download="">
          <span aria-hidden="true">⬇</span> Download
        </a>
        {canShare && (
          <button type="button" className="btn btn-quiet" onClick={share} disabled={busy}>
            <span aria-hidden="true">↗</span> Share
          </button>
        )}
      </div>
      <p className="cal-export-status" role="status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
