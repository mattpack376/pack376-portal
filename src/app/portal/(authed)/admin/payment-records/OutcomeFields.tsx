"use client";

import { useEffect, useRef, useState } from "react";
import { PAYMENT_RECORD_STATUSES, PAYMENT_RECORD_STATUS_LABELS } from "@/lib/paymentRecordView";
import type { PaymentRecordStatus } from "@/generated/prisma/enums";

/**
 * The fields inside a payment record's "Record Outcome" popover. The refund
 * amount and date only show while Refunded is picked, since they mean nothing
 * for any other outcome (the action clears them then anyway).
 *
 * The select is uncontrolled (defaultValue) and only read on change: React
 * resets an action form after every submit, which a controlled select that
 * wasn't server-rendered with the new value would fight. That reset also
 * happens after a refused save, putting the select back to its default, so
 * the refund fields follow the form's reset event as well as the select.
 */
export default function OutcomeFields({
  idPrefix,
  status,
  amountCents,
  refundedCents,
  refundedOn,
  note,
  today,
}: {
  idPrefix: string;
  status: PaymentRecordStatus;
  amountCents: number;
  refundedCents: number | null;
  /** YYYY-MM-DD. */
  refundedOn: string | null;
  note: string | null;
  /** YYYY-MM-DD, the refund date's default and upper limit. */
  today: string;
}) {
  const [refunded, setRefunded] = useState(status === "REFUNDED");
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    const form = selectRef.current?.form;
    if (!form) return;
    // reset fires before the fields change back, so read the default, not the current value.
    const onReset = () => setRefunded(status === "REFUNDED");
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [status]);
  const paid = (amountCents / 100).toFixed(2);

  return (
    <>
      <div className="form-field">
        <label htmlFor={`${idPrefix}-status`}>What happened to it?</label>
        <select
          ref={selectRef}
          id={`${idPrefix}-status`}
          name="status"
          defaultValue={status}
          onChange={(e) => setRefunded(e.target.value === "REFUNDED")}
        >
          {PAYMENT_RECORD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PAYMENT_RECORD_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      {refunded && (
        <>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-amount`}>Amount refunded ($)</label>
            <input
              id={`${idPrefix}-amount`}
              name="refundedAmount"
              type="number"
              min="0.01"
              max={paid}
              step="0.01"
              inputMode="decimal"
              defaultValue={refundedCents === null ? paid : (refundedCents / 100).toFixed(2)}
              required
            />
            <div className="form-note">Up to the ${paid} that was paid.</div>
          </div>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-date`}>Refunded on</label>
            <input id={`${idPrefix}-date`} name="refundedOn" type="date" max={today} defaultValue={refundedOn ?? today} required />
          </div>
        </>
      )}
      <div className="form-field">
        <label htmlFor={`${idPrefix}-note`}>Note (optional)</label>
        <textarea id={`${idPrefix}-note`} name="note" rows={2} maxLength={2000} defaultValue={note ?? ""} />
      </div>
    </>
  );
}
