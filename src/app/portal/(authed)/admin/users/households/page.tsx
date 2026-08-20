import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { denDisplayName, RANK_ORDER } from "@/lib/rankConfig";
import { requireAdminSession } from "@/lib/authorize";
import { createHouseholdAction } from "@/lib/actions/households";
import type { Rank } from "@/generated/prisma/enums";
import UsersSubNav from "@/components/UsersSubNav";

export default async function AdminHouseholdsPage() {
  await requireAdminSession();

  const [households, ungroupedScouts] = await Promise.all([
    prisma.household.findMany({
      include: { scouts: { include: { den: true } }, users: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.scout.findMany({
      where: { householdId: null },
      include: { den: true },
    }),
  ]);
  households.forEach((h) =>
    h.scouts.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))
  );
  ungroupedScouts.sort((a, b) => {
    if (a.den.scoutingYear !== b.den.scoutingYear) return b.den.scoutingYear.localeCompare(a.den.scoutingYear);
    const rankDiff = RANK_ORDER.indexOf(a.den.rank as Rank) - RANK_ORDER.indexOf(b.den.rank as Rank);
    if (rankDiff !== 0) return rankDiff;
    return a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
  });

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Admin</div>
        <h2>Accounts</h2>
        <p>
          Groups siblings (and staff who are also parents) so they show up connected instead of as unrelated rows.
          Doesn&apos;t affect portal access or dues — those stay driven by Parent accounts and each scout&apos;s dues page.
        </p>
      </div>

      <UsersSubNav active="households" />

      <div className="info-card" style={{ maxWidth: 420, marginBottom: 24 }}>
        <h3>New Household</h3>
        <form action={createHouseholdAction} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div className="form-field" style={{ marginBottom: 0, flex: 1 }}>
            <label htmlFor="name">Name (optional)</label>
            <input id="name" name="name" type="text" placeholder="e.g. The Smith Family" />
          </div>
          <button type="submit" className="btn btn-primary">Create</button>
        </form>
      </div>

      <h3 style={{ marginBottom: 10 }}>Households</h3>
      {households.length === 0 ? (
        <p>No households yet — create one above, or open a scout or login&apos;s Manage page to start one.</p>
      ) : (
        <div className="table-scroll" style={{ marginBottom: 28 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Scouts</th>
                <th>Logins</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {households.map((h) => (
                <tr key={h.id}>
                  <td>{h.name || <span style={{ color: "var(--ink-soft)" }}>Unnamed</span>}</td>
                  <td>
                    {h.scouts.length === 0
                      ? "—"
                      : h.scouts
                          .map((s) => `${s.firstName} ${s.lastName} (${denDisplayName(s.den.rank, s.den.scoutingYear, s.den.label)})`)
                          .join(", ")}
                  </td>
                  <td>{h.users.length === 0 ? "—" : h.users.map((u) => u.displayName).join(", ")}</td>
                  <td className="actions">
                    <Link
                      className="btn btn-quiet btn-small"
                      href={`/portal/admin/users/households/${h.id}`}
                    >
                      Manage
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ marginBottom: 10 }}>Scouts Not Yet in a Household</h3>
      {ungroupedScouts.length === 0 ? (
        <p>Every scout is grouped.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Den</th>
              </tr>
            </thead>
            <tbody>
              {ungroupedScouts.map((s) => (
                <tr key={s.id}>
                  <td>{s.firstName} {s.lastName}</td>
                  <td>{denDisplayName(s.den.rank, s.den.scoutingYear, s.den.label)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
