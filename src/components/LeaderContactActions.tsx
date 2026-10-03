import Link from "next/link";
import FileExportButton from "@/components/FileExportButton";
import EmailAllButton from "@/components/EmailAllButton";

/**
 * The Committee & Leaders contact-list tools: Printable View, the CSV and PDF
 * exports, and Email Everyone / Copy Addresses. On the Manage page (Admin) and
 * the read-only list (shown to Admin and Junior Admin only — see
 * canExportLeaderContacts). The caller passes where its own Printable View
 * lives and the addresses to use, already read through linked logins.
 */
export default function LeaderContactActions({
  printHref,
  everyoneEmails,
}: {
  printHref: string;
  everyoneEmails: (string | null)[];
}) {
  return (
    <>
      {/* A div, not a <p>: EmailAllButton renders its own div. */}
      <div className="no-print" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <Link href={printHref} className="btn btn-quiet btn-small">
          Printable View
        </Link>
        <FileExportButton href="/api/leaders/export" label="Export Contact List (CSV)" className="btn btn-quiet btn-small" />
        <FileExportButton href="/api/leaders/export/pdf" label="Export Contact List (PDF)" className="btn btn-quiet btn-small" />
        <EmailAllButton label="Email Everyone" emails={everyoneEmails} />
      </div>
      <p className="form-note no-print" style={{ marginTop: 0 }}>
        The email buttons open your own email app with those people in the To: field and pack376.brooklyn@gmail.com
        + matt.pack376@gmail.com cc&apos;d — nothing is sent from here. <strong>Copy Addresses</strong> copies them
        instead, to paste wherever you like. Each section below has its own pair for just that group.
      </p>
    </>
  );
}
