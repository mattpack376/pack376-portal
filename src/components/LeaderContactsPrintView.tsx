import Link from "next/link";
import PrintButton from "@/components/PrintButton";
import FileExportButton from "@/components/FileExportButton";
import { getLeaderContactList, type LeaderContactSection } from "@/lib/adultLeaderAttendanceData";
import { formatPositions } from "@/lib/adultLeaderSections";
import { formatPhoneNumber } from "@/lib/phone";

/**
 * Printable View: one table per section, the section title and column
 * headings in the <thead> so they repeat on every page a section spans, and
 * each person in their own <tbody> so a row is never split — the same layout
 * (and .print-roster-table styles) as the Parent Contacts printable view.
 * Shared by the Manage page (Admin) and the read-only list (Admin and Junior
 * Admin), each passing the page "Exit" should return to; the caller decides
 * who may see it.
 */
export default async function LeaderContactsPrintView({ backHref }: { backHref: string }) {
  const sections: LeaderContactSection[] = (await getLeaderContactList()).filter((s) => s.people.length > 0);
  const generated = new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <div className="section-head">
        <div className="eyebrow no-print">
          <Link href={backHref}>← Exit Printable View</Link>
        </div>
        <h2>Committee &amp; Leaders Contact Information</h2>
        <p style={{ fontSize: 17 }}>Printable list · generated {generated}</p>
        <p style={{ fontSize: 15, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <PrintButton />
          <FileExportButton href="/api/leaders/export/pdf" label="Download PDF" className="btn btn-quiet no-print" />
        </p>
      </div>

      {sections.length === 0 && <div className="info-card">Nobody is on the list yet.</div>}

      {sections.map(({ section, label, people }) => (
        <table className="print-roster-table" key={section}>
          <colgroup>
            <col style={{ width: "26%" }} />
            <col style={{ width: "26%" }} />
            <col style={{ width: "30%" }} />
            <col style={{ width: "18%" }} />
          </colgroup>
          <thead>
            <tr>
              <th colSpan={4} className="print-den-title">
                {label}
                <span className="print-den-count">
                  {people.length} {people.length === 1 ? "person" : "people"}
                </span>
              </th>
            </tr>
            <tr>
              <th>Name</th>
              <th>Positions</th>
              <th>Email</th>
              <th>Phone</th>
            </tr>
          </thead>
          {people.map((person) => (
            <tbody key={person.id}>
              <tr>
                <td>{person.name}</td>
                <td>{formatPositions(person.positions) || "—"}</td>
                <td>{person.email || "—"}</td>
                <td>{person.phone ? formatPhoneNumber(person.phone) : "—"}</td>
              </tr>
            </tbody>
          ))}
        </table>
      ))}
    </>
  );
}
