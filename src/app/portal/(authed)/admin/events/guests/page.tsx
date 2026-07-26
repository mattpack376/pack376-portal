import Link from "next/link";
import { requireAdminSession } from "@/lib/authorize";
import { getAllGuestGroups } from "@/lib/eventsData";
import { formatCents } from "@/lib/duesData";
import { formatDueDate } from "@/lib/deadlineCategories";
import CollapsibleGroup from "@/components/CollapsibleGroup";

type Group = Awaited<ReturnType<typeof getAllGuestGroups>>[number];

function statusFor(remainingCents: number, paidCents: number) {
  return remainingCents <= 0
    ? { label: remainingCents < 0 ? "Overpaid" : "Paid in Full", cls: "badge-attendance" }
    : paidCents > 0
    ? { label: "Partial", cls: "badge-junior" }
    : { label: "Unpaid", cls: "badge-photographer" };
}

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
  await requireAdminSession();
  const { sort } = await searchParams;
  const sortMode = sort === "family" ? "family" : "guestof";

  const allGroups = await getAllGuestGroups();
  const packTotals = sumTotals(allGroups);

  return (
    <>
      <div className="section-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
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
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- file download (Route Handler), not a page navigation */}
        <a
          className="btn btn-outline btn-small"
          style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
          href="/portal/admin/events/guests/export"
        >
          Export CSV (All Events)
        </a>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <Link
          href="/portal/admin/events/guests?sort=guestof"
          className={`btn btn-small ${sortMode === "guestof" ? "btn-primary" : "btn-outline"}`}
          style={sortMode !== "guestof" ? { borderColor: "var(--scout-blue)", color: "var(--scout-blue)" } : undefined}
        >
          Group by Guest Of
        </Link>
        <Link
          href="/portal/admin/events/guests?sort=family"
          className={`btn btn-small ${sortMode === "family" ? "btn-primary" : "btn-outline"}`}
          style={sortMode !== "family" ? { borderColor: "var(--scout-blue)", color: "var(--scout-blue)" } : undefined}
        >
          Group by Family Name
        </Link>
      </div>

      {allGroups.length === 0 ? (
        <div className="info-card">
          <p style={{ marginBottom: 0 }}>No guest groups registered for any event yet.</p>
        </div>
      ) : sortMode === "guestof" ? (
        <GuestOfGrouping groups={allGroups} />
      ) : (
        <FamilyGrouping groups={allGroups} />
      )}
    </>
  );
}

function guestOfKey(g: Group) {
  if (g.guestOfScoutId) return `scout:${g.guestOfScoutId}`;
  if (g.guestOfUserId) return `user:${g.guestOfUserId}`;
  return "none";
}

function GuestOfGrouping({ groups }: { groups: Group[] }) {
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
            label={`${section.label} — ${totals.adults} adult${totals.adults === 1 ? "" : "s"}, ${totals.kids} kid${totals.kids === 1 ? "" : "s"} · ${formatCents(totals.paid)} paid of ${formatCents(totals.owed)}`}
          >
            {families.map((rows) => (
              <FamilySubTable key={rows[0].familyName + rows[0].id} rows={rows} />
            ))}
          </CollapsibleGroup>
        );
      })}
    </div>
  );
}

function FamilyGrouping({ groups }: { groups: Group[] }) {
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
            label={`${rows[0].familyName} — ${totals.adults} adult${totals.adults === 1 ? "" : "s"}, ${totals.kids} kid${totals.kids === 1 ? "" : "s"} · ${formatCents(totals.paid)} paid of ${formatCents(totals.owed)}`}
          >
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
                  const status = statusFor(g.remainingCents, g.paidCents);
                  return (
                    <tr key={g.id}>
                      <td>{g.event.title} ({formatDueDate(g.event.eventDate)})</td>
                      <td>{g.guestOfLabel ?? "—"}</td>
                      <td>{g.adultCount}</td>
                      <td>{g.childCount}</td>
                      <td>{formatCents(g.paidCents)}</td>
                      <td>{formatCents(g.remainingCents)}</td>
                      <td><span className={`badge-pill ${status.cls}`}>{status.label}</span></td>
                      <td className="actions">
                        <Link
                          className="btn btn-outline btn-small"
                          style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
                          href={`/portal/admin/events/${g.event.id}/guests/${g.id}`}
                        >
                          Manage Payments
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CollapsibleGroup>
        );
      })}
    </div>
  );
}

function FamilySubTable({ rows }: { rows: Group[] }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <p className="form-note" style={{ marginBottom: 6 }}>{rows[0].familyName.toUpperCase()}</p>
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
            const status = statusFor(g.remainingCents, g.paidCents);
            return (
              <tr key={g.id}>
                <td>{g.event.title} ({formatDueDate(g.event.eventDate)})</td>
                <td>{g.adultCount}</td>
                <td>{g.childCount}</td>
                <td>{formatCents(g.paidCents)}</td>
                <td>{formatCents(g.remainingCents)}</td>
                <td><span className={`badge-pill ${status.cls}`}>{status.label}</span></td>
                <td className="actions">
                  <Link
                    className="btn btn-outline btn-small"
                    style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
                    href={`/portal/admin/events/${g.event.id}/guests/${g.id}`}
                  >
                    Manage Payments
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
