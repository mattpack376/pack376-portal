"use client";

import { useState } from "react";
import { shareHrefs } from "@/lib/shareLinks";

/*
 * "Share this page" buttons for public pages (the calendar, trip sites): Text,
 * WhatsApp, Email and Copy Link, each sending the same short message with the
 * page's address. Plain links, so they work with JavaScript off (all but Copy
 * Link) and open the phone's own Messages, WhatsApp or mail app. Text is
 * hidden on computers with a mouse, where an sms: link usually opens nothing.
 * The links build the message from props only: nothing about the visitor
 * goes into them.
 */

export default function ShareLinks({
  url,
  text,
  subject,
  heading = "Share this page",
}: {
  /** The page's public address, absolute (https://…). */
  url: string;
  /** The message before the address, e.g. "Pack 376's Calendar of Events:". */
  text: string;
  /** The email's subject line. */
  subject: string;
  heading?: string;
}) {
  const [copied, setCopied] = useState(false);
  const hrefs = shareHrefs(text, url, subject);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", url);
    }
  }

  return (
    <div className="share-links no-print" role="group" aria-label={heading}>
      <span className="share-links-label">{heading}:</span>
      <a className="btn btn-quiet btn-small share-sms" href={hrefs.sms}>
        <span aria-hidden="true">💬</span> Text
      </a>
      <a className="btn btn-quiet btn-small" href={hrefs.whatsapp} target="_blank" rel="noopener noreferrer">
        <span aria-hidden="true">🟢</span> WhatsApp
      </a>
      <a className="btn btn-quiet btn-small" href={hrefs.email}>
        <span aria-hidden="true">✉️</span> Email
      </a>
      <button type="button" className="btn btn-quiet btn-small" onClick={copy} aria-live="polite">
        <span aria-hidden="true">🔗</span> {copied ? "Copied!" : "Copy Link"}
      </button>
    </div>
  );
}
