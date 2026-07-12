import Link from "next/link";
import { getDuesScoutingYears, getDuesOverview, formatCents } from "@/lib/duesData";
import { RANK_INFO } from "@/lib/rankConfig";
import { setDuesAmountAction } from "@/lib/actions/dues";

export default async function AdminDuesPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const years = await getDuesScoutingYears();
  const { year: requestedYear } = await searchParams;
  const scoutingYear = requestedYear && years.includes(requestedYear) ? requestedYear : years[0];

  if (!scoutingYear) {
    return <div className="info-card">No dens exist yet — create one from the Dashboard first.</div>;
  }

  const { amountCents, dens } = await getDuesOverview(scoutingYear);

  return (
    <>
      <div className="section-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div className="eyebrow">Dues</div>
          <h2>Dues Tracking</h2>
        </div>
        <form style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label htmlFor="year">Scouting Year</label>
            <select id="year" name="year" defaultValue={scoutingYear}>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-outline" style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}>
            Go
          </button>
        </form>
      </div>

      <div className="info-card" style={{ maxWidth: 360, marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Season Fee — {scoutingYear}</h3>
        <p>
          {amountCents === null
            ? "Not set yet. Enter the amount once the pack decides on it."
            : `Current fee: ${formatCents(amountCents)} per scout.`}
        </p>
        <form action={setDuesAmountAction} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <input type="hidden" name="scoutingYear" value={scoutingYear} />
          <div className="form-field" style={{ marginBottom: 0, flex: 1 }}>
            <label htmlFor="amount">Amount ($)</label>
            <input
              id="amount"
              name="amount"
              type="number"
              min="0"
              step="0.01"
              defaultValue={amountCents === null ? "" : (amountCents / 100).toFixed(2)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary">Save</button>
        </form>
      </div>

      {dens.length === 0 && <div className="info-card">No dens for this scouting year.</div>}

      {dens.map((den) => (
        <div key={den.id} style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: 17, marginBottom: 10 }}>
            {RANK_INFO[den.rank].label}{den.label ? ` ${den.label}` : ""}
          </h3>
          {den.scouts.length === 0 ? (
            <p>No scouts in this den yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Paid</th>
                  <th>Remaining</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {den.scouts.map((scout) => {
                  const status =
                    amountCents === null
                      ? { label: "Fee Not Set", cls: "badge-den" }
                      : scout.remainingCents !== null && scout.remainingCents <= 0
                      ? { label: scout.remainingCents < 0 ? "Overpaid" : "Paid in Full", cls: "badge-attendance" }
                      : scout.paidCents > 0
                      ? { label: "Partial", cls: "badge-junior" }
                      : { label: "Unpaid", cls: "badge-photographer" };
                  return (
                    <tr key={scout.id}>
                      <td>{scout.firstName} {scout.lastName}</td>
                      <td>{formatCents(scout.paidCents)}</td>
                      <td>{scout.remainingCents === null ? "—" : formatCents(scout.remainingCents)}</td>
                      <td><span className={`badge-pill ${status.cls}`}>{status.label}</span></td>
                      <td className="actions">
                        <Link
                          className="btn btn-outline btn-small"
                          style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
                          href={`/portal/admin/dues/${scout.id}`}
                        >
                          Manage
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </>
  );
}
