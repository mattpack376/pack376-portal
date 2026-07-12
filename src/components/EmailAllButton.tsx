"use client";

import { useState } from "react";

/**
 * Opens the user's own email client with every address bcc'd, so nothing is
 * ever sent from the server — the leader/admin reviews and sends it
 * themselves. Also offers a copy button since some mail clients truncate very
 * long mailto: URLs (bcc lists on big rosters can exceed that).
 */
export default function EmailAllButton({ emails, label }: { emails: (string | null)[]; label: string }) {
  const [copied, setCopied] = useState(false);
  const unique = Array.from(new Set(emails.filter((e): e is string => !!e && e.trim().length > 0)));

  if (unique.length === 0) {
    return <span style={{ fontSize: 14, color: "var(--ink-soft)" }}>No email addresses on file yet.</span>;
  }

  const mailto = `mailto:?bcc=${encodeURIComponent(unique.join(","))}`;

  const copyAddresses = async () => {
    await navigator.clipboard.writeText(unique.join(", "));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <a href={mailto} className="btn btn-primary btn-small">
        {label} ({unique.length})
      </a>
      <button type="button" onClick={copyAddresses} className="btn btn-outline btn-small">
        {copied ? "Copied!" : "Copy Addresses"}
      </button>
    </div>
  );
}
