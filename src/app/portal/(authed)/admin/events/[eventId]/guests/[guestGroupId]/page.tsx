import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEventPaymentSession } from "@/lib/authorize";
import { getGuestGroupDetail, getGuestOfOptions } from "@/lib/eventsData";
import { formatCents } from "@/lib/duesData";
import { formatAuditTooltip } from "@/lib/auditTooltip";
import { formatDueDate } from "@/lib/deadlineCategories";
import {
  addGuestGroupPaymentAction,
  deleteGuestGroupPaymentAction,
  updateGuestGroupAction,
  removeGuestGroupAction,
} from "@/lib/actions/events";
import GuestOfSelect from "@/components/GuestOfSelect";
import GuestGroupCountFields from "@/components/GuestGroupCountFields";

export default async function AdminGuestGroupPage({
  params,
}: {
  params: Promise<{ eventId: string; guestGroupId: string }>;
}) {
  const session = await requireEventPaymentSession();
  const { eventId, guestGroupId } = await params;

  const group = await getGuestGroupDetail(guestGroupId);
  if (!group || group.event.id !== eventId) notFound();
  // Guest groups aren't tied to a den, so a den login only gets the detail
  // page (full payment history, dates, notes) for a group it self-registered
  // — matches the ownership scoping assertGuestGroupAccess already enforces
  // on the mutation actions below. Admin keeps full access.
  if (session.role === "DEN" && group.addedByUserId !== session.userId) notFound();

  const guestOfOptions = await getGuestOfOptions();
  const guestOfDefault = group.guestOfScoutId ? `scout:${group.guestOfScoutId}` : group.guestOfUserId ? `user:${group.guestOfUserId}` : "";

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">
          <Link href={`/portal/admin/events/${eventId}`}>← {group.event.title}</Link>
        </div>
        <h2>{group.familyName}</h2>
        <p>
          {group.adultCount} adult{group.adultCount === 1 ? "" : "s"}, {group.childCount} kid{group.childCount === 1 ? "" : "s"} ·{" "}
          {formatDueDate(group.event.eventDate)}
          {group.guestOfLabel && ` · Guest of ${group.guestOfLabel}`}
        </p>
      </div>

      <div className="info-card" style={{ maxWidth: 420, marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Details &amp; Balance</h3>
        <p>
          Paid {formatCents(group.paidCents)} of {formatCents(group.amountOwedCents)}
          {group.remainingCents > 0 && ` — ${formatCents(group.remainingCents)} remaining`}
          {group.remainingCents === 0 && " — paid in full"}
          {group.remainingCents < 0 && ` — overpaid by ${formatCents(-group.remainingCents)}`}
        </p>
        <form action={updateGuestGroupAction}>
          <input type="hidden" name="guestGroupId" value={group.id} />
          <input type="hidden" name="eventId" value={eventId} />
          <div className="form-field">
            <label htmlFor="familyName">Family Name / Guest Name</label>
            <input id="familyName" name="familyName" required defaultValue={group.familyName} />
          </div>
          <div className="form-field">
            <label htmlFor="guestOf">Guest Of</label>
            <GuestOfSelect
              id="guestOf"
              densWithScouts={guestOfOptions.densWithScouts}
              staff={guestOfOptions.staff}
              defaultValue={guestOfDefault}
            />
          </div>
          <GuestGroupCountFields
            idPrefix="edit-guest"
            adultFeeCents={group.event.adultFeeCents}
            guestChildFeeCents={group.event.guestChildFeeCents}
            defaultAdultCount={group.adultCount}
            defaultChildCount={group.childCount}
            defaultAmountOwedCents={group.amountOwedCents}
          />
          <button type="submit" className="btn btn-outline btn-small" style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}>
            Save Changes
          </button>
        </form>
        {session.role === "ADMIN" && (
          <form action={removeGuestGroupAction} style={{ marginTop: 12 }}>
            <input type="hidden" name="guestGroupId" value={group.id} />
            <input type="hidden" name="eventId" value={eventId} />
            <button
              type="submit"
              className="btn btn-outline btn-small"
              style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}
            >
              Remove This Group
            </button>
          </form>
        )}
      </div>

      <div className="info-card" style={{ maxWidth: 420, marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Record a Payment</h3>
        <form action={addGuestGroupPaymentAction} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <input type="hidden" name="guestGroupId" value={group.id} />
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
      {group.payments.length === 0 ? (
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
            {group.payments.map((payment) => (
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
                  <form action={deleteGuestGroupPaymentAction}>
                    <input type="hidden" name="paymentId" value={payment.id} />
                    <input type="hidden" name="guestGroupId" value={group.id} />
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
        </div>
      )}
    </>
  );
}
