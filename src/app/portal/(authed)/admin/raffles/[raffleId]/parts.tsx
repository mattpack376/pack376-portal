import EditPopover from "@/components/EditPopover";
import SubmitButton from "@/components/SubmitButton";
import { recordPaymentAction } from "@/lib/actions/raffles";
import { RAFFLE_METHODS, RAFFLE_METHOD_LABELS, type RaffleMethod } from "@/lib/raffleMath";
import { auditDate } from "@/lib/audit";
import type { RaffleEntryDetail } from "@/lib/raffleData";

/* Pieces the raffle tabs share. */

/** A stored date-only value for display; the imported October 2026 raffle has payments with none. */
export function receivedLabel(date: Date | null) {
  return date ? auditDate(date) : "Not recorded";
}

export function MethodSelect({
  id,
  name,
  defaultValue,
  blankLabel,
}: {
  id: string;
  name: string;
  defaultValue?: RaffleMethod | null;
  /** Adds a first, empty choice — for a field that can be left unset. */
  blankLabel?: string;
}) {
  return (
    <select id={id} name={name} defaultValue={defaultValue ?? (blankLabel ? "" : "CASH")}>
      {blankLabel && <option value="">{blankLabel}</option>}
      {RAFFLE_METHODS.map((method) => (
        <option key={method} value={method}>
          {RAFFLE_METHOD_LABELS[method]}
        </option>
      ))}
    </select>
  );
}

/** The names money has arrived under before, offered on every "Paid by" field of a tab. */
export function PayerNameList({ id, names }: { id: string; names: string[] }) {
  return (
    <datalist id={id}>
      {names.map((name) => (
        <option key={name} value={name} />
      ))}
    </datalist>
  );
}

/**
 * The "Payment" button on a buyer's row: records money from them, filled in
 * with what they still owe. `idPrefix` keeps the field ids unique when the
 * same buyer shows on a page twice.
 */
export function RecordPaymentPopover({
  raffleId,
  entry,
  today,
  idPrefix,
  payerListId,
}: {
  raffleId: string;
  entry: RaffleEntryDetail;
  today: string;
  idPrefix: string;
  payerListId: string;
}) {
  const id = `${idPrefix}-${entry.id}`;
  return (
    <EditPopover action={recordPaymentAction} label="Payment">
      <input type="hidden" name="raffleId" value={raffleId} />
      <input type="hidden" name="entryId" value={entry.id} />
      <div className="form-field">
        <label htmlFor={`${id}-amount`}>Amount ($)</label>
        <input
          id={`${id}-amount`}
          name="amount"
          type="number"
          min="0.01"
          step="0.01"
          required
          defaultValue={entry.remainingCents > 0 ? (entry.remainingCents / 100).toFixed(2) : undefined}
        />
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-method`}>How</label>
        <MethodSelect id={`${id}-method`} name="method" />
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-received`}>Received</label>
        <input id={`${id}-received`} name="receivedOn" type="date" defaultValue={today} />
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-payer`}>Paid by someone else? (optional)</label>
        <input id={`${id}-payer`} name="payerName" list={payerListId} autoComplete="off" placeholder="Name on the Zelle" />
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-note`}>Note (optional)</label>
        <input id={`${id}-note`} name="note" />
      </div>
      <SubmitButton className="btn btn-primary btn-small" pendingLabel="Saving…">
        Record Payment
      </SubmitButton>
    </EditPopover>
  );
}
