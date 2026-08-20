import Link from "next/link";
import { notFound } from "next/navigation";
import { getScoutDuesDetail, formatCents } from "@/lib/duesData";
import { formatAuditTooltip } from "@/lib/auditTooltip";
import { denDisplayName } from "@/lib/rankConfig";
import { addDuesPaymentAction, deleteDuesPaymentAction, setScoutDuesOverrideAction } from "@/lib/actions/dues";

export default async function AdminScoutDuesPage({
  params,
}: {
  params: Promise<{ scoutId: string }>;
}) {
  const { scoutId } = await params;
  const data = await getScoutDuesDetail(scoutId);
  if (!data) notFound();

  const { scout, den, standardAmountCents, amountCents, overrideCents, paidCents, remainingCents, payments } = data;

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">
          <Link href="/portal/admin/dues">← Dues</Link>
        </div>
        <h2>{scout.firstName} {scout.lastName}</h2>
        <p>{denDisplayName(den.rank, den.scoutingYear, den.label)}</p>
      </div>

      <div className="info-card" style={{ maxWidth: 420, marginBottom: 24 }}>
        <h3>Balance</h3>
        {amountCents === null ? (
          <p>The season fee hasn&apos;t been set yet for {den.scoutingYear}.</p>
        ) : (
          <p>
            Paid {formatCents(paidCents)} of {formatCents(amountCents)}
            {remainingCents !== null && remainingCents > 0 && ` — ${formatCents(remainingCents)} remaining`}
            {remainingCents !== null && remainingCents === 0 && " — paid in full"}
            {remainingCents !== null && remainingCents < 0 && ` — overpaid by ${formatCents(-remainingCents)}`}
          </p>
        )}
      </div>

      <div className="info-card" style={{ maxWidth: 420, marginBottom: 24 }}>
        <h3>Custom Rate (Sibling Discount, etc.)</h3>
        <p>
          Standard fee is {standardAmountCents === null ? "not set" : formatCents(standardAmountCents)}.
          {overrideCents !== null && ` This scout is set to ${formatCents(overrideCents)} instead.`}
        </p>
        <form action={setScoutDuesOverrideAction} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <input type="hidden" name="scoutId" value={scout.id} />
          <div className="form-field" style={{ marginBottom: 0, flex: 1 }}>
            <label htmlFor="overrideAmount">Amount ($)</label>
            <input
              id="overrideAmount"
              name="amount"
              type="number"
              min="0"
              step="0.01"
              placeholder="Leave blank for standard fee"
              defaultValue={overrideCents === null ? "" : (overrideCents / 100).toFixed(2)}
            />
          </div>
          <button type="submit" className="btn btn-primary">Save</button>
        </form>
      </div>

      <div className="info-card" style={{ maxWidth: 420, marginBottom: 24 }}>
        <h3>Record a Payment</h3>
        <form action={addDuesPaymentAction} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <input type="hidden" name="scoutId" value={scout.id} />
          <div className="form-field" style={{ marginBottom: 0, flex: "1 1 100px" }}>
            <label htmlFor="amount">Amount ($)</label>
            <input id="amount" name="amount" type="number" min="0.01" step="0.01" required />
          </div>
          <div className="form-field" style={{ marginBottom: 0, flex: "1 1 140px" }}>
            <label htmlFor="paidOn">Date</label>
            <input id="paidOn" name="paidOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
          </div>
          <div className="form-field" style={{ marginBottom: 0, flex: "1 1 160px" }}>
            <label htmlFor="note">Note (optional)</label>
            <input id="note" name="note" type="text" placeholder="Cash, check #, Venmo…" />
          </div>
          <button type="submit" className="btn btn-primary">Add Payment</button>
        </form>
      </div>

      <h3 style={{ marginBottom: 10 }}>Payment History</h3>
      {payments.length === 0 ? (
        <p>No payments recorded yet.</p>
      ) : (
        <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Amount</th>
              <th>Note</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => (
              <tr key={payment.id}>
                <td
                  className="audit-hover"
                  data-audit={formatAuditTooltip("Recorded", payment.createdAt, payment.recordedByUsername)}
                >
                  {payment.paidOn.toLocaleDateString("en-US", { timeZone: "UTC" })}
                </td>
                <td>{formatCents(payment.amountCents)}</td>
                <td>{payment.note || "—"}</td>
                <td className="actions">
                  <form action={deleteDuesPaymentAction}>
                    <input type="hidden" name="paymentId" value={payment.id} />
                    <input type="hidden" name="scoutId" value={scout.id} />
                    <button
                      type="submit"
                      className="btn btn-danger btn-small"
                    >
                      Delete
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </>
  );
}
