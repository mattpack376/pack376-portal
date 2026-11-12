import { formatCents } from "@/lib/duesData";
import { balanceClass } from "@/lib/paymentStatus";
import type { LedgerCategorySummary, LedgerSummary } from "@/lib/ledgerMath";

/** An archived category with nothing left in it has nothing to report. */
function shown(category: LedgerCategorySummary) {
  return !category.archived || category.netCents !== 0;
}

function CategoryLine({ category }: { category: LedgerCategorySummary }) {
  return (
    <p style={{ marginBottom: 8 }}>
      <strong>{category.name}:</strong> <span className={balanceClass(category.netCents)}>{formatCents(category.netCents)}</span>
      <span className="form-note" style={{ display: "block", marginTop: 0 }}>
        {formatCents(category.inCents)} in · {formatCents(category.outCents)} out
        {category.archived ? " · archived" : ""}
      </span>
    </p>
  );
}

/**
 * One side of the Funds box: each fund that had money move this way, with
 * its total, then the total for the side. Funds with nothing on this side
 * are left off.
 */
function FlowColumn({
  title,
  funds,
  pick,
  className,
}: {
  title: string;
  funds: LedgerCategorySummary[];
  pick: (category: LedgerCategorySummary) => number;
  className: string;
}) {
  const lines = funds.filter((c) => pick(c) > 0);
  const total = lines.reduce((sum, c) => sum + pick(c), 0);
  return (
    <div>
      <h4 className="ledger-flow-title">{title}</h4>
      {lines.length === 0 ? (
        <p className="form-note" style={{ marginBottom: 0 }}>
          None yet.
        </p>
      ) : (
        <dl className="raffle-ledger">
          {lines.map((c) => (
            <div key={c.id}>
              <dt>
                {c.name}
                {c.archived ? " (archived)" : ""}
              </dt>
              <dd className={className}>{formatCents(pick(c))}</dd>
            </div>
          ))}
          <div className="is-total">
            <dt>Total</dt>
            <dd className={className}>{formatCents(total)}</dd>
          </div>
        </dl>
      )}
    </div>
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
        {/* Wider than its neighbor, so Inflow and Outflow fit side by side. */}
        <div className="info-card" style={{ flex: "2 1 480px" }}>
          <h3>Funds</h3>
          {funds.length === 0 ? (
            <p style={{ marginBottom: 0 }}>No fund categories yet.</p>
          ) : (
            <div className="ledger-flow-cols">
              <FlowColumn title="Inflow (+)" funds={funds} pick={(c) => c.inCents} className="balance-positive" />
              <FlowColumn title="Outflow (−)" funds={funds} pick={(c) => c.outCents} className="balance-negative" />
            </div>
          )}
        </div>
        <div className="info-card">
          <h3>Balances for Events</h3>
          {events.length === 0 ? (
            <p style={{ marginBottom: 0 }}>No event categories yet. Mark a category as an Event on the Categories tab.</p>
          ) : (
            events.map((c) => <CategoryLine key={c.id} category={c} />)
          )}
        </div>
      </div>
    </>
  );
}
