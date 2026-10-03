import Link from "next/link";
import { canExportLeaderContacts, requireLeaderContactsSession } from "@/lib/authorize";
import { getLeaderContactList } from "@/lib/adultLeaderAttendanceData";
import { formatPositions } from "@/lib/adultLeaderSections";
import { formatPhoneNumber } from "@/lib/phone";
import EmailAllButton from "@/components/EmailAllButton";
import LeaderContactActions from "@/components/LeaderContactActions";
import LeaderContactsPrintView from "@/components/LeaderContactsPrintView";

/**
 * The pack's committee members and leaders with their contact details —
 * visible to every staff level, view-only. Admin and Junior Admin also get the
 * export tools (Printable View, CSV, PDF, email/copy addresses). Editing the
 * list is Admin-only and lives on the Manage Leaders & Committee page, which
 * an Admin reaches from the link here.
 */
export default async function LeaderContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await requireLeaderContactsSession();
  const canExport = canExportLeaderContacts(session);
  const { view } = await searchParams;
  // Only the roles that may export get the Printable View; for anyone else the
  // parameter is ignored and they just get the list.
  if (canExport && view === "print") return <LeaderContactsPrintView backHref="/portal/roster/leaders" />;

  const sections = (await getLeaderContactList()).filter((s) => s.people.length > 0);

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">
          <Link href="/portal/roster">← Roster</Link>
        </div>
        <h2>Committee &amp; Leaders</h2>
        <p style={{ fontSize: 17 }}>Who&apos;s on the pack&apos;s committee and leadership team, and how to reach them.</p>
        {session.role === "ADMIN" && (
          <p style={{ fontSize: 15 }}>
            <Link href="/portal/admin/attendance/leaders/manage" className="btn btn-quiet btn-small">
              Edit List
            </Link>
          </p>
        )}
        {canExport && (
          <LeaderContactActions
            printHref="/portal/roster/leaders?view=print"
            everyoneEmails={sections.flatMap((s) => s.people.map((p) => p.email))}
          />
        )}
      </div>

      {sections.length === 0 && <div className="info-card">Nobody has been added to the list yet.</div>}

      {sections.map(({ section, label, people }) => {
        const sectionEmails = people.map((p) => p.email).filter((e): e is string => !!e);
        return (
          <div className="attendance-group" key={section}>
            <div className="attendance-group-head">
              <h3 style={{ marginBottom: 0 }}>{label}</h3>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {canExport && sectionEmails.length > 0 && (
                  <EmailAllButton label={`Email ${label}`} emails={sectionEmails} />
                )}
                <span className="progress-pill">
                  {people.length} {people.length === 1 ? "person" : "people"}
                </span>
              </div>
            </div>
            <div className="table-scroll">
              <table className="data-table" style={{ marginBottom: 0 }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Phone</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((person) => (
                    <tr key={person.id}>
                      <td>
                        <span className="attendance-name">{person.name}</span>
                        {person.positions.length > 0 && (
                          <span className="attendance-detail">{formatPositions(person.positions)}</span>
                        )}
                      </td>
                      <td data-label="Email" style={{ overflowWrap: "anywhere" }}>
                        {person.email ? <a href={`mailto:${person.email}`}>{person.email}</a> : "—"}
                      </td>
                      <td data-label="Phone">{person.phone ? formatPhoneNumber(person.phone) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
}
