import Link from "next/link";
import { requireEventsViewSession } from "@/lib/authorize";
import { getAllGuestGroups } from "@/lib/eventsData";
import { formatCents } from "@/lib/duesData";
import { formatDueDate } from "@/lib/deadlineCategories";
import CollapsibleGroup from "@/components/CollapsibleGroup";
import { paymentStatus, paymentRowClass } from "@/lib/paymentStatus";
import SegmentedNav from "@/components/SegmentedNav";

type Group = Awaited<ReturnType<typeof getAllGuestGroups>>[number];


function sumTotals(groups: Group[]) {
  return groups.reduce(
    (acc, g) => ({
      adults: acc.adults + g.adultCount,
      kids: acc.kids + g.childCount,
      owed: acc.owed + g.amountOwedCents,
      paid: acc.paid + g.paidCents,
      remaining: acc.remaining + g.remainingCents,
    }),
    { adults: 0, kids: 0, owed: 0, paid: 0, remaining: 0 },
  );
}

export default async function AdminAllGuestsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  // Junior Admin reads it; the CSV export and payment edits are Admin-only.
  const session = await requireEventsViewSession();
  const canEdit = session.role === "ADMIN";
  const { sort } = await searchParams;
  const sortMode = sort === "family" ? "family" : "guestof";

  const allGroups = await getAllGuestGroups();
  const packTotals = sumTotals(allGroups);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link href="/portal/admin/events">← Events</Link>
          </div>
          <h2>All Guests</h2>
          <p style={{ fontSize: 17 }}>
            Every guest group across every event — {packTotals.adults} adult{packTotals.adults === 1 ? "" : "s"},{" "}
            {packTotals.kids} kid{packTotals.kids === 1 ? "" : "s"} · {formatCents(packTotals.paid)} paid of{" "}
            {formatCents(packTotals.owed)} owed
            {packTotals.remaining > 0 && ` — ${formatCents(packTotals.remaining)} remaining`}.
          </p>
        </div>
        {canEdit && (
          // eslint-disable-next-line @next/next/no-html-link-for-pages -- file download (Route Handler), not a page navigation
          <a
            className="btn btn-quiet btn-small"
            href="/portal/admin/events/guests/export"
          >
            Export CSV (All Attendees)
          </a>
        )}
      </div>

      <SegmentedNav
        active={sortMode}
        items={[
          { key: "guestof", href: "/portal/admin/events/guests?sort=guestof", label: "Group by Guest Of" },
          { key: "family", href: "/portal/admin/events/guests?sort=family", label: "Group by Family Name" },
        ]}
      />

      {allGroups.length === 0 ? (
        <div className="info-card">
          <p>No guest groups registered for any event yet.</p>
        </div>
      ) : sortMode === "guestof" ? (
        <GuestOfGrouping groups={allGroups} canEdit={canEdit} />
      ) : (
        <FamilyGrouping groups={allGroups} canEdit={canEdit} />
      )}
    </>
  );
}

function guestOfKey(g: Group) {
  if (g.guestOfScoutId) return `scout:${g.guestOfScoutId}`;
  if (g.guestOfUserId) return `user:${g.guestOfUserId}`;
  return "none";
}

function GuestOfGrouping({ groups, canEdit }: { groups: Group[]; canEdit: boolean }) {
  const byGuestOf = new Map<string, { label: string; groups: Group[] }>();
  for (const g of groups) {
    const key = guestOfKey(g);
    if (!byGuestOf.has(key)) byGuestOf.set(key, { label: g.guestOfLabel ?? "Unlinked / Other Families", groups: [] });
    byGuestOf.get(key)!.groups.push(g);
  }

  const sections = Array.from(byGuestOf.values()).sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div>
      {sections.map((section) => {
        const totals = sumTotals(section.groups);
        const byFamily = new Map<string, Group[]>();
        for (const g of section.groups) {
          const key = g.familyName.trim().toLowerCase();
          if (!byFamily.has(key)) byFamily.set(key, []);
          byFamily.get(key)!.push(g);
        }
        const families = Array.from(byFamily.values()).sort((a, b) => a[0].familyName.localeCompare(b[0].familyName));

        return (
          <CollapsibleGroup
            key={section.label}
            labelClassName={paymentRowClass(totals.remaining, totals.paid)}
            label={`${section.label} — ${totals.adults} adult${totals.adults === 1 ? "" : "s"}, ${totals.kids} kid${totals.kids === 1 ? "" : "s"} · ${formatCents(totals.paid)} paid of ${formatCents(totals.owed)}`}
          >
            {families.map((rows) => (
              <FamilySubTable key={rows[0].familyName + rows[0].id} rows={rows} canEdit={canEdit} />
            ))}
          </CollapsibleGroup>
        );
      })}
    </div>
  );
}

function FamilyGrouping({ groups, canEdit }: { groups: Group[]; canEdit: boolean }) {
  const byFamily = new Map<string, Group[]>();
  for (const g of groups) {
    const key = g.familyName.trim().toLowerCase();
    if (!byFamily.has(key)) byFamily.set(key, []);
    byFamily.get(key)!.push(g);
  }
  const families = Array.from(byFamily.values()).sort((a, b) => a[0].familyName.localeCompare(b[0].familyName));

  return (
    <div>
      {families.map((rows) => {
        const totals = sumTotals(rows);
        return (
          <CollapsibleGroup
            key={rows[0].familyName + rows[0].id}
            labelClassName={paymentRowClass(totals.remaining, totals.paid)}
            label={`${rows[0].familyName} — ${totals.adults} adult${totals.adults === 1 ? "" : "s"}, ${totals.kids} kid${totals.kids === 1 ? "" : "s"} · ${formatCents(totals.paid)} paid of ${formatCents(totals.owed)}`}
          >
            <div className="table-scroll">
            <table className="data-table" style={{ marginBottom: 0 }}>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Guest Of</th>
                  <th>Adults</th>
                  <th>Kids</th>
                  <th>Paid</th>
                  <th>Remaining</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((g) => {
                  const status = paymentStatus(g.remainingCents, g.paidCents);
                  return (
                    <tr key={g.id} className={paymentRowClass(g.remainingCents, g.paidCents)}>
                      <td>{g.event.title} ({formatDueDate(g.event.eventDate)})</td>
                      <td data-label="Guest Of">{g.guestOfLabel ?? "—"}</td>
                      <td data-label="Adults">{g.adultCount}</td>
                      <td data-label="Kids">{g.childCount}</td>
                      <td data-label="Paid">{formatCents(g.paidCents)}</td>
                      <td data-label="Remaining">{formatCents(g.remainingCents)}</td>
                      <td data-label="Status"><span className={`badge-pill ${status.cls}`}>{status.label}</span></td>
                      <td className="actions">
                        <Link
                          className="btn btn-quiet btn-small"
                          href={`/portal/admin/events/${g.event.id}/guests/${g.id}`}
                        >
                          {canEdit ? "Manage Payments" : "View Payments"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </CollapsibleGroup>
        );
      })}
    </div>
  );
}

function FamilySubTable({ rows, canEdit }: { rows: Group[]; canEdit: boolean }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <p className="form-note" style={{ marginBottom: 6 }}>{rows[0].familyName.toUpperCase()}</p>
      <div className="table-scroll">
      <table className="data-table" style={{ marginBottom: 0 }}>
        <thead>
          <tr>
            <th>Event</th>
            <th>Adults</th>
            <th>Kids</th>
            <th>Paid</th>
            <th>Remaining</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => {
            const status = paymentStatus(g.remainingCents, g.paidCents);
            return (
              <tr key={g.id} className={paymentRowClass(g.remainingCents, g.paidCents)}>
                <td>{g.event.title} ({formatDueDate(g.event.eventDate)})</td>
                <td data-label="Adults">{g.adultCount}</td>
                <td data-label="Kids">{g.childCount}</td>
                <td data-label="Paid">{formatCents(g.paidCents)}</td>
                <td data-label="Remaining">{formatCents(g.remainingCents)}</td>
                <td data-label="Status"><span className={`badge-pill ${status.cls}`}>{status.label}</span></td>
                <td className="actions">
                  <Link
                    className="btn btn-quiet btn-small"
                    href={`/portal/admin/events/${g.event.id}/guests/${g.id}`}
                  >
                    {canEdit ? "Manage Payments" : "View Payments"}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
