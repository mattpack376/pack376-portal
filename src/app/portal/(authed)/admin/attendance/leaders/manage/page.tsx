import Link from "next/link";
import SaveButton from "@/components/SaveButton";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/authorize";
import { leaderContact } from "@/lib/adultLeaderContact";
import {
  getAdultLeaderRoster,
  getLeaderContactList,
  type LeaderContactSection,
} from "@/lib/adultLeaderAttendanceData";
import { ADULT_LEADER_SECTIONS, ADULT_LEADER_SECTION_LABELS, formatPositions } from "@/lib/adultLeaderSections";
import {
  createAdultLeaderAction,
  updateAdultLeaderAction,
  setAdultLeaderActiveAction,
} from "@/lib/actions/adultLeaders";
import DeleteAdultLeaderButton from "@/components/DeleteAdultLeaderButton";
import type { AdultLeaderSection } from "@/generated/prisma/enums";
import EditPopover from "@/components/EditPopover";
import FileExportButton from "@/components/FileExportButton";
import PrintButton from "@/components/PrintButton";
import { formatPhoneNumber } from "@/lib/phone";

type AccountOption = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  adultLeader: { id: string } | null;
};

type LeaderForFields = {
  id: string;
  name: string;
  positions: string[];
  section: AdultLeaderSection;
  email: string | null;
  phone: string | null;
  userId: string | null;
  user: { id: string; username: string; email: string | null; phone: string | null } | null;
};

/**
 * Name / positions / section / portal-account inputs, shared by the Add form
 * and each row's Edit popover. A linked person's popover has no email/phone
 * inputs — their login holds the only copy, edited on the account page — and
 * the action treats the missing fields as "leave alone".
 */
function LeaderFields({
  idPrefix,
  leader,
  accounts,
}: {
  idPrefix: string;
  leader?: LeaderForFields;
  accounts: AccountOption[];
}) {
  // Logins not already tied to someone else on the list, likely matches first
  // (same name, or the address typed here is the account's) so linking an
  // existing person is a one-click pick.
  const nameKey = leader?.name.trim().toLowerCase();
  const emailKey = leader?.email?.trim().toLowerCase();
  const options = accounts
    .filter((a) => !a.adultLeader || a.adultLeader.id === leader?.id)
    .map((a) => ({
      ...a,
      likely:
        a.id !== leader?.userId &&
        ((!!nameKey && a.displayName.trim().toLowerCase() === nameKey) ||
          (!!emailKey && a.email?.trim().toLowerCase() === emailKey)),
    }))
    .sort((a, b) => Number(b.likely) - Number(a.likely));

  return (
    <>
      <div className="form-field">
        <label htmlFor={`${idPrefix}-name`}>Name</label>
        <input
          id={`${idPrefix}-name`}
          name="name"
          required
          maxLength={100}
          defaultValue={leader?.name}
          placeholder="e.g. Jane Smith"
        />
      </div>
      <div className="form-field">
        <label htmlFor={`${idPrefix}-positions`}>Positions</label>
        <input
          id={`${idPrefix}-positions`}
          name="positions"
          defaultValue={leader?.positions.join(", ")}
          placeholder="e.g. Tiger Den Leader"
        />
        <p className="form-note">Separate more than one with commas — e.g. Cubmaster, Arrow of Light Den Leader.</p>
      </div>
      <div className="form-field">
        <label htmlFor={`${idPrefix}-section`}>Section</label>
        <select id={`${idPrefix}-section`} name="section" defaultValue={leader?.section ?? "LEADERS"}>
          {ADULT_LEADER_SECTIONS.map((section) => (
            <option key={section} value={section}>
              {ADULT_LEADER_SECTION_LABELS[section]}
            </option>
          ))}
        </select>
      </div>
      <div className="form-field">
        <label htmlFor={`${idPrefix}-user`}>Portal account</label>
        <select id={`${idPrefix}-user`} name="userId" defaultValue={leader?.userId ?? ""}>
          <option value="">No login — keep contact info here</option>
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName} ({a.username}){a.likely ? " — likely match" : ""}
            </option>
          ))}
        </select>
        <p className="form-note">
          If they have a portal login, pick it: their email and phone are then kept in one place, on the account,
          instead of being typed here too.
        </p>
      </div>
      {leader?.user ? (
        <div className="form-field">
          <label>Email &amp; phone</label>
          <p className="form-note" style={{ marginTop: 0 }}>
            Kept on their portal account: {leader.user.email ?? "no email"} ·{" "}
            {leader.user.phone ? formatPhoneNumber(leader.user.phone) : "no phone"}.{" "}
            <Link href={`/portal/admin/users/${leader.user.id}`}>Edit on the account page →</Link>
          </p>
        </div>
      ) : (
        <>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-email`}>Email (optional)</label>
            <input
              id={`${idPrefix}-email`}
              name="email"
              type="email"
              maxLength={200}
              defaultValue={leader?.email ?? ""}
              placeholder="e.g. jane@example.com"
            />
            <p className="form-note">Included when you use Email Everyone on the Admin Dashboard.</p>
          </div>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-phone`}>Phone (optional)</label>
            <input
              id={`${idPrefix}-phone`}
              name="phone"
              type="tel"
              maxLength={40}
              defaultValue={leader?.phone ?? ""}
              placeholder="e.g. (718)555-0123"
            />
          </div>
        </>
      )}
    </>
  );
}

/**
 * Printable View: one table per section, the section title and column
 * headings in the <thead> so they repeat on every page a section spans, and
 * each person in their own <tbody> so a row is never split — the same layout
 * (and .print-roster-table styles) as the Parent Contacts printable view.
 */
async function PrintableLeaders() {
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
          <Link href="/portal/admin/attendance/leaders/manage">← Exit Printable View</Link>
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

export default async function ManageAdultLeadersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  await requireAdminSession();
  const { view } = await searchParams;
  if (view === "print") return <PrintableLeaders />;

  const [roster, accounts] = await Promise.all([
    getAdultLeaderRoster(),
    // Anyone who signs in as themselves can be linked; a Parent Portal login
    // or the shared trip-viewer login isn't a person on this list.
    prisma.user.findMany({
      where: { role: { notIn: ["PARENT", "TRIP_VIEWER"] } },
      select: { id: true, username: true, displayName: true, email: true, adultLeader: { select: { id: true } } },
      orderBy: { displayName: "asc" },
    }),
  ]);
  const removed = roster.filter((l) => !l.active);

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">
          <Link href="/portal/admin/attendance/leaders">← Leaders &amp; Committee</Link>
        </div>
        <h2>Manage Leaders &amp; Committee</h2>
        <p>
          Who&apos;s on the leader &amp; committee attendance tracker. Someone who holds more than one position is
          listed once with all of them, so their attendance is taken once per meeting.
        </p>
        <p>
          This is also the place to keep contact info for committee members and leaders who don&apos;t need a portal
          login. Adding someone here never creates an account or sends a sign-up link — their email is just included
          when you use Email Everyone on the Admin Dashboard. If someone does have a login, link it
          (<strong>Portal account</strong> when you add or edit them) and their email and phone are read from the
          account, so the same details aren&apos;t kept in two places.
        </p>
        <p style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Link href="/portal/admin/attendance/leaders/manage?view=print" className="btn btn-quiet btn-small no-print">
            Printable View
          </Link>
          <FileExportButton
            href="/api/leaders/export"
            label="Export Contact List (CSV)"
            className="btn btn-quiet btn-small no-print"
          />
          <FileExportButton
            href="/api/leaders/export/pdf"
            label="Export Contact List (PDF)"
            className="btn btn-quiet btn-small no-print"
          />
        </p>
      </div>

      <div className="info-card" style={{ maxWidth: 480, marginBottom: 24 }}>
        <h3>Add Someone</h3>
        <form action={createAdultLeaderAction}>
          <LeaderFields idPrefix="new" accounts={accounts} />
          <button type="submit" className="btn btn-primary">
            Add to List
          </button>
        </form>
      </div>

      {ADULT_LEADER_SECTIONS.map((section) => {
        const people = roster.filter((l) => l.active && l.section === section);
        return (
          <div className="attendance-group" key={section}>
            <div className="attendance-group-head">
              <h3 style={{ marginBottom: 0 }}>{ADULT_LEADER_SECTION_LABELS[section]}</h3>
              <span className="progress-pill">
                {people.length} {people.length === 1 ? "person" : "people"}
              </span>
            </div>
            {people.length === 0 ? (
              <div className="attendance-card">
                <p style={{ padding: "12px 0" }}>Nobody in this section yet.</p>
              </div>
            ) : (
              // No .table-scroll wrapper, and has-popovers: both would otherwise
              // clip each row's Edit popover to the table.
              <table className="data-table has-popovers" style={{ marginBottom: 0 }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((leader) => {
                    const contact = leaderContact(leader);
                    return (
                    <tr key={leader.id}>
                      <td>
                        <span className="attendance-name">{leader.name}</span>
                        {leader.positions.length > 0 && (
                          <span className="attendance-detail">{formatPositions(leader.positions)}</span>
                        )}
                        {leader.user && (
                          <span className="attendance-detail">Portal login: {leader.user.username}</span>
                        )}
                      </td>
                      <td data-label="Email" style={{ overflowWrap: "anywhere" }}>
                        {contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : "—"}
                      </td>
                      <td data-label="Phone">{contact.phone ? formatPhoneNumber(contact.phone) : "—"}</td>
                      <td className="actions">
                        <EditPopover action={updateAdultLeaderAction}>
                          <input type="hidden" name="id" value={leader.id} />
                          <LeaderFields idPrefix={`leader-${leader.id}`} leader={leader} accounts={accounts} />
                          <SaveButton className="btn btn-primary btn-small">Save Changes</SaveButton>
                        </EditPopover>
                        <form action={setAdultLeaderActiveAction}>
                          <input type="hidden" name="id" value={leader.id} />
                          <input type="hidden" name="active" value="false" />
                          <button type="submit" className="btn btn-quiet btn-small">
                            Remove
                          </button>
                        </form>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      {removed.length > 0 && (
        <div className="attendance-group">
          <div className="attendance-group-head">
            <h3 style={{ marginBottom: 0 }}>Removed</h3>
          </div>
          <p className="form-note" style={{ marginTop: 0, marginBottom: 12 }}>
            Off the tracker going forward, but still shown on the meetings they were already marked for.
          </p>
          <div className="attendance-card">
            {removed.map((leader) => (
              <div className="attendance-row" key={leader.id}>
                <div>
                  <span className="attendance-name">{leader.name}</span>
                  <span className="attendance-detail">
                    {leader.positions.length > 0 && `${formatPositions(leader.positions)} — `}
                    {leader._count.attendances} attendance mark{leader._count.attendances === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="attendance-buttons">
                  <form action={setAdultLeaderActiveAction}>
                    <input type="hidden" name="id" value={leader.id} />
                    <input type="hidden" name="active" value="true" />
                    <button type="submit" className="btn btn-quiet btn-small">
                      Restore
                    </button>
                  </form>
                  <DeleteAdultLeaderButton
                    adultLeaderId={leader.id}
                    name={leader.name}
                    markCount={leader._count.attendances}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
