import Link from "next/link";
import { requireLeaderContactsSession } from "@/lib/authorize";
import { getLeaderContactList } from "@/lib/adultLeaderAttendanceData";
import { formatPositions } from "@/lib/adultLeaderSections";
import { formatPhoneNumber } from "@/lib/phone";

/**
 * The pack's committee members and leaders with their contact details —
 * visible to every staff level, view-only. Editing the list (and exporting
 * it) is Admin-only and lives on the Manage Leaders & Committee page, which
 * an Admin reaches from the link here.
 */
export default async function LeaderContactsPage() {
  const session = await requireLeaderContactsSession();
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
              Edit List &amp; Export
            </Link>
          </p>
        )}
      </div>

      {sections.length === 0 && <div className="info-card">Nobody has been added to the list yet.</div>}

      {sections.map(({ section, label, people }) => (
        <div className="attendance-group" key={section}>
          <div className="attendance-group-head">
            <h3 style={{ marginBottom: 0 }}>{label}</h3>
            <span className="progress-pill">
              {people.length} {people.length === 1 ? "person" : "people"}
            </span>
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
      ))}
    </>
  );
}
