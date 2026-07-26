import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEventPaymentSession } from "@/lib/authorize";
import { getAdultRegistrationDetail } from "@/lib/eventsData";
import { formatCents } from "@/lib/duesData";
import { formatAuditTooltip } from "@/lib/auditTooltip";
import { formatDueDate } from "@/lib/deadlineCategories";
import {
  addAdultEventPaymentAction,
  deleteAdultEventPaymentAction,
  updateAdultRegistrationAction,
  removeAdultRegistrationAction,
} from "@/lib/actions/events";

export default async function AdminAdultRegistrationPage({
  params,
}: {
  params: Promise<{ eventId: string; adultRegistrationId: string }>;
}) {
  const session = await requireEventPaymentSession();
  const { eventId, adultRegistrationId } = await params;

  const reg = await getAdultRegistrationDetail(adultRegistrationId);
  if (!reg || reg.event.id !== eventId) notFound();

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">
          <Link href={`/portal/admin/events/${eventId}`}>← {reg.event.title}</Link>
        </div>
        <h2>{reg.name}</h2>
        <p>{formatDueDate(reg.event.eventDate)}</p>
      </div>

      <div className="info-card" style={{ maxWidth: 420, marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Details &amp; Balance</h3>
        <p>
          Paid {formatCents(reg.paidCents)} of {formatCents(reg.amountOwedCents)}
          {reg.remainingCents > 0 && ` — ${formatCents(reg.remainingCents)} remaining`}
          {reg.remainingCents === 0 && " — paid in full"}
          {reg.remainingCents < 0 && ` — overpaid by ${formatCents(-reg.remainingCents)}`}
        </p>
        <form action={updateAdultRegistrationAction} style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <input type="hidden" name="adultRegistrationId" value={reg.id} />
          <input type="hidden" name="eventId" value={eventId} />
          <div className="form-field" style={{ marginBottom: 0, flex: "1 1 160px" }}>
            <label htmlFor="name">Name</label>
            <input id="name" name="name" required defaultValue={reg.name} />
          </div>
          <div className="form-field" style={{ marginBottom: 0, flex: "1 1 140px" }}>
            <label htmlFor="amountOwed">Amount Owed ($)</label>
            <input
              id="amountOwed"
              name="amountOwed"
              type="number"
              min="0"
              step="0.01"
              required
              defaultValue={(reg.amountOwedCents / 100).toFixed(2)}
            />
          </div>
          <button type="submit" className="btn btn-outline btn-small" style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}>
            Save Changes
          </button>
        </form>
        {session.role === "ADMIN" && (
          <form action={removeAdultRegistrationAction} style={{ marginTop: 12 }}>
            <input type="hidden" name="adultRegistrationId" value={reg.id} />
            <input type="hidden" name="eventId" value={eventId} />
            <button
              type="submit"
              className="btn btn-outline btn-small"
              style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}
            >
              Remove This Registration
            </button>
          </form>
        )}
      </div>

      <div className="info-card" style={{ maxWidth: 420, marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Record a Payment</h3>
        <form action={addAdultEventPaymentAction} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <input type="hidden" name="adultRegistrationId" value={reg.id} />
          <input type="hidden" name="eventId" value={eventId} />
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
      {reg.payments.length === 0 ? (
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
            {reg.payments.map((payment) => (
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
                  <form action={deleteAdultEventPaymentAction}>
                    <input type="hidden" name="paymentId" value={payment.id} />
                    <input type="hidden" name="adultRegistrationId" value={reg.id} />
                    <input type="hidden" name="eventId" value={eventId} />
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
