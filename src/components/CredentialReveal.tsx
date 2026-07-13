"use client";

import { useState } from "react";
import type { CreatedInvite } from "@/lib/actions/dens";

export default function CredentialReveal({
  invite,
  emailedTo,
}: {
  invite?: CreatedInvite;
  emailedTo?: string;
}) {
  const [copied, setCopied] = useState(false);

  if (emailedTo) {
    return (
      <div className="info-card" style={{ borderLeft: "6px solid var(--teal)", marginTop: 16 }}>
        <p style={{ marginBottom: 0, fontWeight: 700, color: "var(--scout-blue-dark)" }}>
          ✉️ A setup link was emailed to {emailedTo}.
        </p>
      </div>
    );
  }

  if (!invite) return null;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(invite!.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — the link is still visible to copy by hand.
    }
  }

  return (
    <div className="info-card" style={{ borderLeft: "6px solid var(--teal)", marginTop: 16 }}>
      <p style={{ marginBottom: 8, fontWeight: 700, color: "var(--scout-blue-dark)" }}>
        Share this link with <strong>{invite.username}</strong> — it works once and expires soon:
      </p>
      <p style={{ fontFamily: "monospace", fontSize: 13, wordBreak: "break-all", marginBottom: 8 }}>
        {invite.url}
      </p>
      <button type="button" className="btn btn-outline btn-small" onClick={copyLink}>
        {copied ? "Copied!" : "Copy Link"}
      </button>
    </div>
  );
}
