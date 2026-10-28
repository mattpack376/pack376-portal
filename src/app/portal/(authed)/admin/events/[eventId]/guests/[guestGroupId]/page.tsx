import Link from "next/link";
import SaveButton from "@/components/SaveButton";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import { notFound } from "next/navigation";
import { requireEventsViewSession } from "@/lib/authorize";
import { getGuestGroupDetail, getGuestOfOptions } from "@/lib/eventsData";
import { formatCents } from "@/lib/duesData";
import { paymentDeletionWarning } from "@/lib/paymentRecords";
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
import { todayDateOnlyString } from "@/lib/dateOnly";
import ActionForm from "@/components/ActionForm";
import TripAdminForm from "@/components/TripAdminForm";
import SubmitButton from "@/components/SubmitButton";
import { MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from "@/lib/formValues";
import { ADMIN_GUEST_GROUP_MAX_PEOPLE, adminGuestGroupEditMaxPeople } from "@/lib/guestGroupLimits";
import { guestGroupEditVersion } from "@/lib/eventEditVersion";

/**
 * Added to a payment's Delete prompt: deleting it doesn't lose the money
 * record (see src/lib/paymentRecords.ts).
 */
const KEPT_PAYMENT_NOTE =
  " The payment record will be kept under Admin → Payment Records, where you can mark it refunded or kept by the pack.";

export default async function AdminGuestGroupPage({
  params,
}: {
  params: Promise<{ eventId: string; guestGroupId: string }>;
}) {
  // Junior Admin reads the balance and payment history; only Admin edits the
  // group or records and deletes payments.
  const session = await requireEventsViewSession();
  const canEdit = session.role === "ADMIN";
  const { eventId, guestGroupId } = await params;

  const group = await getGuestGroupDetail(guestGroupId);
  if (!group || group.event.id !== eventId) notFound();

  const guestOfOptions = await getGuestOfOptions({ scoutId: group.guestOfScoutId, userId: group.guestOfUserId });
  const guestOfDefault = group.guestOfScoutId ? `scout:${group.guestOfScoutId}` : group.guestOfUserId ? `user:${group.guestOfUserId}` : "";

  // Saved before the edit form's limits existed: the form says so, and the
  // action accepts the name as long as it comes back unchanged and the size
  // as long as it doesn't grow.
  const groupPeople = group.adultCount + group.childCount;
  const editMaxPeople = adminGuestGroupEditMaxPeople(groupPeople);
  const nameOverLimit = group.familyName.length > MAX_NAME_LENGTH;

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
        <h3>Details &amp; Balance</h3>
        <p>
          Paid {formatCents(group.paidCents)} of {formatCents(group.amountOwedCents)}
          {group.remainingCents > 0 && ` — ${formatCents(group.remainingCents)} remaining`}
          {group.remainingCents === 0 && " — paid in full"}
          {group.remainingCents < 0 && ` — overpaid by ${formatCents(-group.remainingCents)}`}
        </p>
        {canEdit && (
        // TripAdminForm: a refusal is shown above the fields. One about what was
        // typed puts the entries back; one because another Admin changed the
        // group since this page loaded (the version below no longer matches)
        // shows the group as it now stands instead.
        <TripAdminForm action={updateGuestGroupAction}>
          <input type="hidden" name="guestGroupId" value={group.id} />
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="version" value={guestGroupEditVersion(group)} />
          <div className="form-field">
            <label htmlFor="familyName">Family Name / Guest Name</label>
            <input id="familyName" name="familyName" required maxLength={MAX_NAME_LENGTH} defaultValue={group.familyName} />
            {nameOverLimit && (
              <p className="form-note">
                Saved before names were limited to {MAX_NAME_LENGTH} characters. It can stay as it is; a changed name
                has to fit.
              </p>
            )}
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
            maxPeople={editMaxPeople}
          />
          {groupPeople > ADMIN_GUEST_GROUP_MAX_PEOPLE && (
            <p className="form-note" style={{ marginTop: 0 }}>
              Saved with {groupPeople} people, before a group was limited to {ADMIN_GUEST_GROUP_MAX_PEOPLE}. It can keep
              that many or fewer, but not more.
            </p>
          )}
          <SaveButton className="btn btn-quiet btn-small">Save Changes</SaveButton>
        </TripAdminForm>
        )}
        {canEdit && (
          <form action={removeGuestGroupAction} style={{ marginTop: 12 }}>
            <input type="hidden" name="guestGroupId" value={group.id} />
            <input type="hidden" name="eventId" value={eventId} />
            <ConfirmSubmitButton
              className="btn btn-danger btn-small"
              pendingLabel="Removing…"
              message={`Remove the guest group “${group.familyName}” from “${group.event.title}”?${paymentDeletionWarning({ count: group.payments.length, totalCents: group.paidCents })} This can't be undone.`}
            >
              Remove This Group
            </ConfirmSubmitButton>
          </form>
        )}
      </div>

      {canEdit && (
      <div className="info-card" style={{ maxWidth: 420, marginBottom: 24 }}>
        <h3>Record a Payment</h3>
        <ActionForm action={addGuestGroupPaymentAction}>
          <input type="hidden" name="guestGroupId" value={group.id} />
          <input type="hidden" name="eventId" value={eventId} />
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="form-field" style={{ marginBottom: 0, flex: "1 1 100px" }}>
              <label htmlFor="amount">Amount ($)</label>
              <input id="amount" name="amount" type="number" min="0.01" step="0.01" required />
            </div>
            <div className="form-field" style={{ marginBottom: 0, flex: "1 1 140px" }}>
              <label htmlFor="paidOn">Date</label>
              <input id="paidOn" name="paidOn" type="date" defaultValue={todayDateOnlyString()} />
            </div>
            <div className="form-field" style={{ marginBottom: 0, flex: "1 1 160px" }}>
              <label htmlFor="note">Note (optional)</label>
              <input id="note" name="note" type="text" maxLength={MAX_NOTE_LENGTH} placeholder="Cash, check #, Venmo…" />
            </div>
            <SubmitButton className="btn btn-primary" pendingLabel="Adding…">Add Payment</SubmitButton>
          </div>
        </ActionForm>
      </div>
      )}

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
              {canEdit && <th></th>}
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
                <td data-label="Amount">{formatCents(payment.amountCents)}</td>
                <td data-label="Note">{payment.note || "—"}</td>
                {canEdit && (
                <td className="actions">
                  <form action={deleteGuestGroupPaymentAction}>
                    <input type="hidden" name="paymentId" value={payment.id} />
                    <input type="hidden" name="guestGroupId" value={group.id} />
                    <input type="hidden" name="eventId" value={eventId} />
                    <ConfirmSubmitButton
                      className="btn btn-danger btn-small"
                      pendingLabel="Deleting…"
                      message={`Delete the ${formatCents(payment.amountCents)} payment from ${payment.paidOn.toLocaleDateString("en-US", { timeZone: "UTC" })}?${KEPT_PAYMENT_NOTE} This can't be undone.`}
                    >
                      Delete
                    </ConfirmSubmitButton>
                  </form>
                </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </>
  );
}
