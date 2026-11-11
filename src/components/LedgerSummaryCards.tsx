import { formatCents } from "@/lib/duesData";
import { balanceClass } from "@/lib/paymentStatus";
import type { LedgerCategorySummary, LedgerSummary } from "@/lib/ledgerMath";

/** An archived category with nothing left in it has nothing to report. */
function shown(category: LedgerCategorySummary) {
  return !category.archived || category.netCents !== 0;
}

/**
 * One box's categories as a table: income and expenses in their own columns,
 * then what's left. On a phone each row becomes a small card (the shared
 * .data-table rules).
 */
function CategoryTable({ categories, label }: { categories: LedgerCategorySummary[]; label: string }) {
  return (
    <table className="data-table" style={{ marginBottom: 0, boxShadow: "none" }}>
      <thead>
        <tr>
          <th>{label}</th>
          <th>Income</th>
          <th>Expenses</th>
          <th>Balance</th>
        </tr>
      </thead>
      <tbody>
        {categories.map((c) => (
          <tr key={c.id}>
            <td>
              {c.name}
              {c.archived && <span className="form-note"> (archived)</span>}
            </td>
            <td data-label="Income" className={c.inCents > 0 ? "balance-positive" : undefined}>
              {formatCents(c.inCents)}
            </td>
            <td data-label="Expenses" className={c.outCents > 0 ? "balance-negative" : undefined}>
              {formatCents(c.outCents)}
            </td>
            <td data-label="Balance" className={balanceClass(c.netCents)} style={{ fontWeight: 700 }}>
              {formatCents(c.netCents)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The Ledger's summary boxes, like the top of the treasurer's Sheet: the bank
 * balance, what's free to spend once money held for events is set aside, each
 * fund's balance, and "Balances for Events". Every figure is all time;
 * `periodLabel` adds the chosen year's money in and out (moves between
 * categories left out).
 */
export default function LedgerSummaryCards({
  summary,
  periodLabel,
}: {
  summary: LedgerSummary;
  /** "2026-2027", or null for every year. */
  periodLabel: string | null;
}) {
  const funds = summary.categories.filter((c) => c.kind === "FUND" && shown(c));
  const events = summary.categories.filter((c) => c.kind === "EVENT" && shown(c));

  return (
    <>
      <div className="card-row">
        <div className="info-card">
          <h3>Total Bank Balance</h3>
          <p className={balanceClass(summary.bankBalanceCents)} style={{ fontSize: 26, fontWeight: 800, marginBottom: 6 }}>
            {formatCents(summary.bankBalanceCents)}
          </p>
          <p className="form-note" style={{ marginBottom: 0 }}>
            {periodLabel ? `${periodLabel}: ` : "All years: "}
            {formatCents(summary.periodInCents)} in · {formatCents(summary.periodOutCents)} out
          </p>
        </div>
        <div className="info-card">
          <h3>Available to Spend</h3>
          <p
            className={balanceClass(summary.availableToSpendCents)}
            style={{ fontSize: 26, fontWeight: 800, marginBottom: 6 }}
          >
            {formatCents(summary.availableToSpendCents)}
          </p>
          <p className="form-note" style={{ marginBottom: 0 }}>
            The bank balance less money still held for events (below).
          </p>
        </div>
      </div>

      <div className="card-row">
        <div className="info-card">
          <h3>Funds</h3>
          {funds.length === 0 ? <p style={{ marginBottom: 0 }}>No fund categories yet.</p> : <CategoryTable categories={funds} label="Fund" />}
        </div>
        <div className="info-card">
          <h3>Balances for Events</h3>
          {events.length === 0 ? (
            <p style={{ marginBottom: 0 }}>No event categories yet. Mark a category as an Event on the Categories tab.</p>
          ) : (
            <CategoryTable categories={events} label="Event" />
          )}
        </div>
      </div>
    </>
  );
}
