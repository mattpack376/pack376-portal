"use client";

import CopyAddressesButton from "@/components/CopyAddressesButton";

const ALWAYS_CC = ["pack376.brooklyn@gmail.com", "matt.pack376@gmail.com"];

/**
 * Opens the user's own email client with every address in the To: field and
 * the pack's two standing addresses always cc'd, so nothing is ever sent from
 * the server — the leader/admin reviews and sends it themselves. Also offers
 * a copy button since some mail clients truncate very long mailto: URLs
 * (recipient lists on big rosters can exceed that).
 */
export default function EmailAllButton({ emails, label }: { emails: (string | null)[]; label: string }) {
  // Deduped ignoring case and padding, like CopyAddressesButton: someone can now
  // be on file as a parent, a login, and a committee entry with the address
  // typed slightly differently, and the count on the button should match.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of emails) {
    const email = raw?.trim();
    if (!email || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    unique.push(email);
  }

  if (unique.length === 0) {
    return <span style={{ fontSize: 14, color: "var(--ink-soft)" }}>No email addresses on file yet.</span>;
  }

  const mailto = `mailto:?to=${encodeURIComponent(unique.join(","))}&cc=${encodeURIComponent(ALWAYS_CC.join(","))}`;

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <a href={mailto} className="btn btn-primary btn-small">
        {label} ({unique.length})
      </a>
      <CopyAddressesButton emails={unique} />
    </div>
  );
}
