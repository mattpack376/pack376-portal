"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { monthTitle } from "@/lib/calendarData";
import { exportFileName, type ExportFormat } from "@/lib/calendarExport";

/*
 * "Download or Share": pick a month (or the full year) and PDF or picture,
 * then download it, or on a phone hand it straight to the share sheet (text,
 * WhatsApp, email). The files come from src/app/calendar/export/[file].
 *
 * Sharing a file needs the file in hand at the moment of the tap — iPhone
 * Safari refuses navigator.share once the tap is more than a moment old, so
 * waiting for a download first would fail. On a device that can share files,
 * the card therefore fetches the selected file once it scrolls into view (and
 * again for each new choice), and Share uses that copy — one small file,
 * cached by the server. If it isn't ready yet, Share fetches it and asks for
 * one more tap.
 *
 * On the portal (admin calendar page) the file lives on the public host, so
 * `baseUrl` is absolute and the link opens in a new tab; sharing is left to
 * the public page, where the fetch is same-origin.
 */

/** Whether this browser can hand a file to the share sheet (phones and tablets, mostly). */
function browserCanShareFiles() {
  if (typeof navigator === "undefined" || !navigator.canShare) return false;
  try {
    return navigator.canShare({ files: [new File(["x"], "test.png", { type: "image/png" })] });
  } catch {
    return false;
  }
}
const noSubscription = () => () => {};

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "pdf", label: "PDF (best for printing)" },
  { value: "png", label: "Picture (PNG, best for texting)" },
];

export default function CalendarExportCard({
  months,
  yearLabel,
  defaultScope,
  baseUrl = "",
  allowShare = true,
}: {
  /** The month keys the calendar has a section for. */
  months: string[];
  yearLabel: string;
  /** "full" or a month key. */
  defaultScope: string;
  /** "" on the public site; the public origin from the portal. */
  baseUrl?: string;
  allowShare?: boolean;
}) {
  const id = useId();
  const [scope, setScope] = useState(defaultScope);
  const [format, setFormat] = useState<ExportFormat>("pdf");
  // False on the server and in the first render, so the page hydrates cleanly.
  const shareSupported = useSyncExternalStore(noSubscription, browserCanShareFiles, () => false);
  const canShare = allowShare && shareSupported;
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const engaged = useRef(false);
  const card = useRef<HTMLDivElement>(null);
  const files = useRef(new Map<string, File>());
  const pending = useRef(new Map<string, Promise<File>>());

  const fileName = exportFileName(scope, format, yearLabel);
  const href = `${baseUrl}/calendar/export/${fileName}`;
  const label = scope === "full" ? `${yearLabel} calendar` : monthTitle(scope);

  function load(name: string, url: string): Promise<File> {
    const existing = pending.current.get(name);
    if (existing) return existing;
    const promise = fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const file = new File([blob], name, { type: blob.type || (name.endsWith(".pdf") ? "application/pdf" : "image/png") });
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

  async function share() {
    setStatus("");
    const ready = files.current.get(fileName);
    if (ready) {
      try {
        await navigator.share({ files: [ready], title: `Pack 376 ${label}` });
      } catch (error) {
        if ((error as DOMException)?.name !== "AbortError") setStatus("Sharing didn't work here. Use Download instead.");
      }
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
        <a
          className="btn btn-primary"
          href={href}
          download={baseUrl ? undefined : fileName}
          target={baseUrl ? "_blank" : undefined}
          rel={baseUrl ? "noopener noreferrer" : undefined}
        >
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
