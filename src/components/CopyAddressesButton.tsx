"use client";

import { useState } from "react";

/**
 * One click copies every email address, comma-separated, ready to paste into
 * the To: line of any mail client. Blanks are skipped and duplicates dropped
 * (ignoring case, so a family entered twice with different capitalization is
 * one address). If the browser won't allow clipboard access, the addresses
 * are shown in a prompt to copy by hand instead. Renders nothing when there
 * are no addresses.
 */
export default function CopyAddressesButton({
  emails,
  label = "Copy Addresses",
  showCount = false,
}: {
  emails: (string | null)[];
  label?: string;
  showCount?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of emails) {
    const email = raw?.trim();
    if (!email || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    unique.push(email);
  }
  if (unique.length === 0) return null;

  const copy = async () => {
    const text = unique.join(", ");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy these addresses:", text);
    }
  };

  return (
    <button type="button" onClick={copy} className="btn btn-quiet btn-small">
      {copied ? "Copied!" : showCount ? `${label} (${unique.length})` : label}
    </button>
  );
}
