import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/authorize";
import { formatCents } from "@/lib/duesData";
import { formatDateOnly, toDateOnlyString, todayDateOnlyString } from "@/lib/dateOnly";
import { resolvePaymentRecordAction } from "@/lib/actions/paymentRecords";
import {
  PAYMENT_RECORD_FILTERS,
  PAYMENT_RECORD_STATUS_BADGES,
  PAYMENT_RECORD_STATUS_LABELS,
  paymentMethodLabel,
  paymentRecordContact,
  paymentRecordFilterWhere,
  paymentRecordKindLabel,
  paymentRecordVersion,
  parsePaymentRecordFilter,
  type PaymentRecordFilter,
} from "@/lib/paymentRecordView";
import type { Prisma } from "@/generated/prisma/client";
import SegmentedNav from "@/components/SegmentedNav";
import FileExportButton from "@/components/FileExportButton";
import EditPopover from "@/components/EditPopover";
import SubmitButton from "@/components/SubmitButton";
import OutcomeFields from "./OutcomeFields";

/** Newest first; the totals and the CSV export still cover every record in the tab. */
const LIST_LIMIT = 200;

const day = (date: Date | null) => (date ? formatDateOnly(toDateOnlyString(date)) : "—");
const when = (date: Date) =>
  date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * Payment records kept when something with payments attached was deleted — a
 * scout, an event, a guest group, a trip registration, a raffle, or a single
 * payment (src/lib/paymentRecords.ts). The money itself happened, so the
 * record outlives the delete; here an Admin says what became of it: refunded
 * (how much, when), kept by the pack, or entered by mistake.
 *
 * Admin only, like Receipts: these are families' payments and contact
 * details, and deciding a refund is a treasurer's call.
 */
export default async function PaymentRecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdminSession();
  const filter = parsePaymentRecordFilter((await searchParams).status);
  const where = paymentRecordFilterWhere(filter);
  // Family money only, matching the delete warnings' totals: trip expenses and
  // vendor credits are the pack's own spending, and a voided raffle payment
  // was never counted as collected.
  const moneyWhere: Prisma.PaymentRecordWhereInput = { ...where, kind: { not: "TRIP_EXPENSE" }, wasVoided: false };

  const [records, total, money, refunds, byStatus] = await Promise.all([
    prisma.paymentRecord.findMany({ where, orderBy: [{ deletedAt: "desc" }, { id: "asc" }], take: LIST_LIMIT }),
    prisma.paymentRecord.count({ where }),
    prisma.paymentRecord.aggregate({ where: moneyWhere, _sum: { amountCents: true }, _count: true }),
    prisma.paymentRecord.aggregate({ where, _sum: { refundedCents: true } }),
    prisma.paymentRecord.groupBy({ by: ["status"], _count: true }),
  ]);

  const statusCounts = new Map(byStatus.map((row) => [row.status, row._count]));
  const allCount = byStatus.reduce((sum, row) => sum + row._count, 0);
  const tabs = (Object.keys(PAYMENT_RECORD_FILTERS) as PaymentRecordFilter[]).map((key) => {
    const def = PAYMENT_RECORD_FILTERS[key];
    const count = def.status ? (statusCounts.get(def.status) ?? 0) : allCount;
    return {
      key,
      href: key === "needs" ? "/portal/admin/payment-records" : `/portal/admin/payment-records?status=${key}`,
      label: `${def.label} (${count})`,
    };
  });
  const today = todayDateOnlyString();

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Money</div>
          <h2>Payment Records</h2>
          <p>
            When a scout, event, guest group, trip registration, raffle or payment is deleted, the payments attached to
            it are kept here. Record what became of each one — refunded, kept by the pack, or entered by mistake.
          </p>
        </div>
      </div>

      <SegmentedNav items={tabs} active={filter} />

      <div className="card-row">
        <div className="info-card">
          <h3>Records</h3>
          <p style={{ fontSize: 28, fontWeight: 700, color: "var(--scout-blue)", margin: 0 }}>{total}</p>
          <p>{PAYMENT_RECORD_FILTERS[filter].label}</p>
        </div>
        <div className="info-card">
          <h3>Paid by Families</h3>
          <p style={{ fontSize: 28, fontWeight: 700, color: "var(--scout-blue)", margin: 0 }}>
            {formatCents(money._sum.amountCents ?? 0)}
          </p>
          <p>Trip expenses and voided raffle payments aren&apos;t counted.</p>
        </div>
        <div className="info-card">
          <h3>Refunded</h3>
          <p style={{ fontSize: 28, fontWeight: 700, color: "var(--scout-blue)", margin: 0 }}>
            {formatCents(refunds._sum.refundedCents ?? 0)}
          </p>
          <p>Of the records in this tab.</p>
        </div>
      </div>

      {total > 0 && (
        <p style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
          <FileExportButton
            href={`/portal/admin/payment-records/export${filter === "needs" ? "" : `?status=${filter}`}`}
            label="Export CSV"
            className="btn btn-quiet btn-small"
          />
        </p>
      )}

      {total === 0 ? (
        <div className="info-card">
          {filter === "needs"
            ? "Nothing waiting on a decision. Payments kept from a delete will show up here."
            : filter === "all"
              ? "No payment records yet. Nothing with payments attached has been deleted."
              : `No records marked “${PAYMENT_RECORD_FILTERS[filter].label}”.`}
        </div>
      ) : (
        // No .table-scroll wrapper: it would clip the Record Outcome popover.
        // Below 640px the rows stack into cards (data-label) anyway.
        <table className="data-table has-popovers">
          <thead>
            <tr>
              <th>Paid for</th>
              <th>Amount</th>
              <th>Paid on</th>
              <th>Deleted</th>
              <th>Outcome</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const contact = paymentRecordContact(r.details);
              const method = paymentMethodLabel(r.method);
              const version = paymentRecordVersion(r);
              return (
                <tr key={r.id}>
                  <td>
                    <div>{r.paidFor}</div>
                    <div className="form-note" style={{ marginTop: 4 }}>
                      {paymentRecordKindLabel(r.kind, r.isCredit)}
                      {r.paidBy && <> · {r.kind === "TRIP_EXPENSE" ? (r.isCredit ? "Received by" : "Paid by") : "From"} {r.paidBy}</>}
                      {method && <> · {method}</>}
                      {r.recordedByName && <> · recorded by {r.recordedByName}</>}
                    </div>
                    {(contact.email || contact.phone) && (
                      <div className="form-note" style={{ marginTop: 2 }}>
                        {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
                        {contact.email && contact.phone && " · "}
                        {contact.phone && <a href={`tel:${contact.phone}`}>{contact.phone}</a>}
                      </div>
                    )}
                    {r.note && (
                      <div className="form-note" style={{ marginTop: 2 }}>
                        Note: {r.note}
                      </div>
                    )}
                    {r.wasVoided && (
                      <div className="form-note" style={{ marginTop: 2 }}>
                        Already voided before it was deleted{r.voidReason ? `: ${r.voidReason}` : ""}.
                      </div>
                    )}
                  </td>
                  <td data-label="Amount">
                    {r.kind === "TRIP_EXPENSE" && r.isCredit ? `+${formatCents(r.amountCents)}` : formatCents(r.amountCents)}
                  </td>
                  <td data-label="Paid on">{day(r.paidOn)}</td>
                  <td data-label="Deleted">
                    <div>{r.deletionReason}</div>
                    <div className="form-note" style={{ marginTop: 2 }}>
                      {when(r.deletedAt)}
                      {r.deletedByName && <> by {r.deletedByName}</>}
                    </div>
                    {r.capturedBy === "database" && (
                      <div
                        className="form-note"
                        style={{ marginTop: 2 }}
                        title="The delete didn't copy this payment itself, so the database's safety net saved it with what the payment row alone knew."
                      >
                        Saved by safety net — some details may be missing.
                      </div>
                    )}
                  </td>
                  <td data-label="Outcome">
                    <span className={`badge-pill ${PAYMENT_RECORD_STATUS_BADGES[r.status]}`}>
                      {PAYMENT_RECORD_STATUS_LABELS[r.status]}
                    </span>
                    {r.status === "REFUNDED" && r.refundedCents !== null && (
                      <div style={{ marginTop: 4 }}>
                        {formatCents(r.refundedCents)} on {day(r.refundedOn)}
                      </div>
                    )}
                    {r.resolutionNote && (
                      <div className="form-note" style={{ marginTop: 2, whiteSpace: "pre-line" }}>
                        {r.resolutionNote}
                      </div>
                    )}
                    {r.resolvedAt && (
                      <div className="form-note" style={{ marginTop: 2 }}>
                        Updated {when(r.resolvedAt)}
                        {r.resolvedByName && <> by {r.resolvedByName}</>}
                      </div>
                    )}
                  </td>
                  <td className="actions">
                    {/* Keyed by the fingerprint so a saved outcome remounts the form with its new defaults. */}
                    <EditPopover key={version} action={resolvePaymentRecordAction} label="Record Outcome">
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="version" value={version} />
                      <OutcomeFields
                        idPrefix={`pr-${r.id}`}
                        status={r.status}
                        amountCents={r.amountCents}
                        refundedCents={r.refundedCents}
                        refundedOn={toDateOnlyString(r.refundedOn)}
                        note={r.resolutionNote}
                        today={today}
                      />
                      <SubmitButton className="btn btn-primary btn-small" pendingLabel="Saving…">
                        Save Outcome
                      </SubmitButton>
                    </EditPopover>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {total > LIST_LIMIT && (
        <p className="form-note">
          Showing the latest {LIST_LIMIT} of {total}. The totals and the CSV export include every one.
        </p>
      )}
    </>
  );
}
