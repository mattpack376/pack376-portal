import Link from "next/link";
import { notFound } from "next/navigation";
import { getScoutDuesDetail, formatCents } from "@/lib/duesData";
import { denDisplayName } from "@/lib/rankConfig";
import { addDuesPaymentAction, deleteDuesPaymentAction } from "@/lib/actions/dues";

export default async function AdminScoutDuesPage({
  params,
}: {
  params: Promise<{ scoutId: string }>;
}) {
  const { scoutId } = await params;
  const data = await getScoutDuesDetail(scoutId);
  if (!data) notFound();

  const { scout, den, amountCents, paidCents, remainingCents, payments } = data;

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
        <h3 style={{ marginTop: 0 }}>Balance</h3>
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
        <h3 style={{ marginTop: 0 }}>Record a Payment</h3>
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
                <td>{payment.paidOn.toLocaleDateString("en-US", { timeZone: "UTC" })}</td>
                <td>{formatCents(payment.amountCents)}</td>
                <td>{payment.note || "—"}</td>
                <td className="actions">
                  <form action={deleteDuesPaymentAction}>
                    <input type="hidden" name="paymentId" value={payment.id} />
                    <input type="hidden" name="scoutId" value={scout.id} />
                    <button
                      type="submit"
                      className="btn btn-outline btn-small"
                      style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}
                    >
                      Delete
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
