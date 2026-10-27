import ActionForm from "@/components/ActionForm";
import CollapsibleGroup from "@/components/CollapsibleGroup";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import EditPopover from "@/components/EditPopover";
import SubmitButton from "@/components/SubmitButton";
import {
  recordPaymentAction,
  restorePaymentAction,
  setPaymentVerifiedAction,
  updatePaymentAction,
  verifyAllPaymentsAction,
  voidPaymentAction,
} from "@/lib/actions/raffles";
import { formatAuditTooltip } from "@/lib/auditTooltip";
import { PACK_TIME_ZONE, toDateOnlyString } from "@/lib/dateOnly";
import { formatCents } from "@/lib/duesData";
import { MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from "@/lib/formValues";
import { RAFFLE_METHODS, RAFFLE_METHOD_LABELS, buyerNameKey, formatBoxNumbers, type RaffleMethod } from "@/lib/raffleMath";
import { paymentEditVersion } from "@/lib/raffleEditVersion";
import type { RaffleDetail, RafflePaymentDetail } from "@/lib/raffleData";
import { MethodSelect, PayerNameList, RecordPaymentPopover, receivedLabel } from "./parts";

const PAYER_LIST_ID = "payments-payer-names";

/** What "verified" means for each method — the instruction over its check-off list. */
const VERIFY_HINT: Record<RaffleMethod, string> = {
  CASH: "Tick each one off as you count the cash in hand.",
  ZELLE: "Tick each one off as you find it on the bank statement.",
  CHECK: "Tick each one off once the check is in hand.",
  OTHER: "Tick each one off once you've confirmed the money arrived.",
};

/**
 * The money side of a raffle. Three separate questions, kept separate:
 * who still owes (no payment exists yet), what has been received (a payment
 * exists), and what has been verified (someone counted it or found it at the
 * bank). An IOU never shows up as cash.
 */
export default function PaymentsTab({
  raffle,
  canRecord,
  canManage,
  helperUserId,
  today,
  payerNames,
  payerHistory,
}: {
  raffle: RaffleDetail;
  /** Admin or Raffle Helper on an open raffle: may record a buyer's payment. */
  canRecord: boolean;
  /** Admin on an open raffle: verifies, corrects and voids payments, and handles money not matched to a buyer. */
  canManage: boolean;
  /**
   * The signed-in Raffle Helper's id on an open raffle, null for everyone
   * else. A helper gets a Void button on the payments they recorded
   * themselves, until an Admin verifies them — see voidPaymentAction.
   */
  helperUserId: string | null;
  today: string;
  payerNames: string[];
  /** buyerNameKey of a payer name -> the buyer their money was for last time. */
  payerHistory: Map<string, string>;
}) {
  const s = raffle.summary;
  const live = raffle.payments.filter((payment) => !payment.voidedAt);
  const voided = raffle.payments.filter((payment) => payment.voidedAt);
  const unmatched = live.filter((payment) => payment.entryId === null);
  const owing = raffle.entries.filter((entry) => entry.remainingCents > 0);
  const methodsInUse = RAFFLE_METHODS.filter((method) => s.byMethod[method].receivedCents > 0);

  /** A helper may void only what they recorded themselves, and only while it's unverified. */
  const helperCanVoid = (payment: RafflePaymentDetail) =>
    helperUserId !== null && payment.recordedByUserId === helperUserId && !payment.verifiedAt;

  function voidPopover(payment: RafflePaymentDetail) {
    return (
      <EditPopover action={voidPaymentAction} label="Void">
        <input type="hidden" name="paymentId" value={payment.id} />
        <p style={{ fontSize: 14.5 }}>
          Voiding strikes out this {formatCents(payment.amountCents)} payment so it stops counting. It stays listed
          under Voided Payments{canManage ? " and can be restored." : ", and an Admin can restore it."}
        </p>
        <div className="form-field">
          <label htmlFor={`pay-${payment.id}-reason`}>Why?</label>
          <input id={`pay-${payment.id}-reason`} name="reason" required maxLength={MAX_NOTE_LENGTH} placeholder="e.g. entered twice" />
        </div>
        <SubmitButton className="btn btn-danger btn-small" pendingLabel="Voiding…">
          Void Payment
        </SubmitButton>
      </EditPopover>
    );
  }

  /** The Edit and Void buttons on a payment's row, for an Admin. */
  function paymentActions(payment: RafflePaymentDetail, editLabel = "Edit") {
    const id = `pay-${payment.id}`;
    return (
      <>
        <EditPopover action={updatePaymentAction} label={editLabel}>
          <input type="hidden" name="paymentId" value={payment.id} />
          {/* What this form was filled in with: refused if another Admin corrects the payment meanwhile. */}
          <input type="hidden" name="version" value={paymentEditVersion(payment)} />
          <div className="form-field">
            <label htmlFor={`${id}-entry`}>For</label>
            <select id={`${id}-entry`} name="entryId" defaultValue={payment.entryId ?? ""}>
              <option value="">Not matched to a buyer yet</option>
              {raffle.entries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} ({formatBoxNumbers(entry.boxNumbers)})
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor={`${id}-amount`}>Amount ($)</label>
            <input
              id={`${id}-amount`}
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
              defaultValue={(payment.amountCents / 100).toFixed(2)}
            />
          </div>
          <div className="form-field">
            <label htmlFor={`${id}-method`}>How</label>
            <MethodSelect id={`${id}-method`} name="method" defaultValue={payment.method} />
          </div>
          <div className="form-field">
            <label htmlFor={`${id}-payer`}>Paid by (if not the buyer)</label>
            <input
              id={`${id}-payer`}
              name="payerName"
              list={PAYER_LIST_ID}
              autoComplete="off"
              maxLength={MAX_NAME_LENGTH}
              defaultValue={payment.payerName ?? ""}
            />
          </div>
          <div className="form-field">
            <label htmlFor={`${id}-received`}>Received</label>
            <input id={`${id}-received`} name="receivedOn" type="date" defaultValue={toDateOnlyString(payment.receivedOn) ?? ""} />
          </div>
          <div className="form-field">
            <label htmlFor={`${id}-note`}>Note (optional)</label>
            <input id={`${id}-note`} name="note" maxLength={MAX_NOTE_LENGTH} defaultValue={payment.note ?? ""} />
          </div>
          <p className="form-note" style={{ marginTop: 0 }}>
            Changing the amount or how it was paid clears its Verified tick.
          </p>
          <SubmitButton className="btn btn-primary btn-small" pendingLabel="Saving…">
            Save
          </SubmitButton>
        </EditPopover>
        {voidPopover(payment)}
      </>
    );
  }

  return (
    <>
      {canRecord && <PayerNameList id={PAYER_LIST_ID} names={payerNames} />}

      <div className="card-row">
        <div className="info-card">
          <h3>Where the Money Stands</h3>
          <dl className="raffle-ledger">
            <div>
              <dt>
                Boxes sold
                <small>
                  {s.soldBoxes} of {s.boxCount} at {formatCents(raffle.priceCents)}
                </small>
              </dt>
              <dd>{formatCents(s.salesCents)}</dd>
            </div>
            {RAFFLE_METHODS.filter((method) => method === "CASH" || method === "ZELLE" || s.byMethod[method].receivedCents > 0).map(
              (method) => (
                <div key={method}>
                  <dt>{RAFFLE_METHOD_LABELS[method]} received</dt>
                  <dd>{formatCents(s.byMethod[method].receivedCents)}</dd>
                </div>
              )
            )}
            <div className="is-total">
              <dt>Total collected</dt>
              <dd>{formatCents(s.collectedCents)}</dd>
            </div>
            <div>
              <dt>
                Still owed by buyers
                <small>IOUs — not counted as collected</small>
              </dt>
              <dd className={s.outstandingCents > 0 ? "balance-negative" : undefined}>{formatCents(s.outstandingCents)}</dd>
            </div>
            {s.unmatchedCents > 0 && (
              <div>
                <dt>
                  Not matched to a buyer yet
                  <small>Included in total collected</small>
                </dt>
                <dd className="balance-negative">{formatCents(s.unmatchedCents)}</dd>
              </div>
            )}
            {s.overpaidCents > 0 && (
              <div>
                <dt>Overpaid by buyers</dt>
                <dd>{formatCents(s.overpaidCents)}</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="info-card">
          <h3>Prize and Pack Share</h3>
          <dl className="raffle-ledger">
            <div>
              <dt>
                {s.prizeIsFinal ? "Winner's prize" : "Winner's prize so far"}
                <small>
                  {raffle.prizePercent}% of boxes sold
                  {s.prizeIsFinal ? (raffle.prizePaid ? " — paid" : " — not paid yet") : " — fixed when the winner is recorded"}
                </small>
              </dt>
              <dd>{formatCents(s.prizeCents)}</dd>
            </div>
            <div>
              <dt>
                Pack&apos;s share
                <small>Boxes sold minus the prize</small>
              </dt>
              <dd>{formatCents(s.packShareCents)}</dd>
            </div>
            <div className="is-total">
              <dt>
                Pack has in hand
                <small>Collected minus the prize</small>
              </dt>
              <dd className={s.netCents < 0 ? "balance-negative" : undefined}>{formatCents(s.netCents)}</dd>
            </div>
            <div>
              <dt>
                Received, not verified yet
                <small>Cash to count or Zelle to find at the bank</small>
              </dt>
              <dd className={s.unverifiedCents > 0 ? "balance-negative" : undefined}>{formatCents(s.unverifiedCents)}</dd>
            </div>
          </dl>
        </div>
      </div>

      <h3 style={{ fontSize: 17, margin: "8px 0 6px" }}>Still Owes</h3>
      {owing.length === 0 ? (
        <p style={{ marginBottom: 28 }}>{raffle.entries.length === 0 ? "No boxes sold yet." : "Nobody — every buyer has paid."}</p>
      ) : (
        <>
          <p style={{ marginBottom: 12 }}>
            No money has been recorded for these yet. Record a payment only when it actually arrives.
          </p>
          <table className="data-table has-popovers" style={{ marginBottom: 28 }}>
            <thead>
              <tr>
                <th>Buyer</th>
                <th>Boxes</th>
                <th>Paid</th>
                <th>Still Owes</th>
                {canRecord && <th></th>}
              </tr>
            </thead>
            <tbody>
              {owing.map((entry) => (
                <tr key={entry.id} className="status-owing">
                  <td>{entry.name}</td>
                  <td data-label="Boxes">{formatBoxNumbers(entry.boxNumbers)}</td>
                  <td data-label="Paid">{formatCents(entry.paidCents)}</td>
                  <td data-label="Still Owes">{formatCents(entry.remainingCents)}</td>
                  {canRecord && (
                    <td className="actions">
                      <RecordPaymentPopover
                        raffleId={raffle.id}
                        entry={entry}
                        today={today}
                        idPrefix="owes-pay"
                        payerListId={PAYER_LIST_ID}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {(unmatched.length > 0 || canManage) && <h3 style={{ fontSize: 17, margin: "0 0 6px" }}>Money Not Matched to a Buyer</h3>}
      {unmatched.length > 0 && (
        <table className="data-table has-popovers" style={{ marginBottom: 16 }}>
          <thead>
            <tr>
              <th>Came From</th>
              <th>Amount</th>
              <th>How</th>
              <th>Received</th>
              <th>Last Time</th>
              {canManage && <th></th>}
            </tr>
          </thead>
          <tbody>
            {unmatched.map((payment) => {
              const lastFor = payerHistory.get(buyerNameKey(payment.payerName ?? ""));
              return (
                <tr key={payment.id} className="status-owing">
                  <td className="audit-hover" data-audit={formatAuditTooltip("Recorded", payment.createdAt, payment.recordedByUsername)}>
                    {payment.payerName ?? "Unknown"}
                    {payment.note && (
                      <span className="form-note" style={{ display: "block", marginTop: 2, fontWeight: 400 }}>
                        {payment.note}
                      </span>
                    )}
                  </td>
                  <td data-label="Amount">{formatCents(payment.amountCents)}</td>
                  <td data-label="How">{RAFFLE_METHOD_LABELS[payment.method]}</td>
                  <td data-label="Received">{receivedLabel(payment.receivedOn)}</td>
                  <td data-label="Last Time">{lastFor ? `Was for ${lastFor}` : "—"}</td>
                  {canManage && <td className="actions">{paymentActions(payment, "Match to Buyer")}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {canManage && (
        <CollapsibleGroup label="Record Money You Can't Place Yet" defaultOpen={false}>
          <div className="info-card" style={{ maxWidth: 560, marginTop: 10 }}>
            <p>
              For a Zelle from a name you don&apos;t recognize. It counts as collected right away, and you match it
              to a buyer once you know whose boxes it&apos;s for.
            </p>
            <ActionForm action={recordPaymentAction}>
              <input type="hidden" name="raffleId" value={raffle.id} />
              <input type="hidden" name="entryId" value="" />
              <div className="form-row">
                <div className="form-field">
                  <label htmlFor="loose-payer">Came from</label>
                  <input
                    id="loose-payer"
                    name="payerName"
                    list={PAYER_LIST_ID}
                    autoComplete="off"
                    required
                    maxLength={MAX_NAME_LENGTH}
                    placeholder="Name on the Zelle"
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="loose-amount">Amount ($)</label>
                  <input id="loose-amount" name="amount" type="number" min="0.01" step="0.01" required />
                </div>
              </div>
              <div className="form-row">
                <div className="form-field">
                  <label htmlFor="loose-method">How</label>
                  <MethodSelect id="loose-method" name="method" defaultValue="ZELLE" />
                </div>
                <div className="form-field">
                  <label htmlFor="loose-received">Received</label>
                  <input id="loose-received" name="receivedOn" type="date" defaultValue={today} />
                </div>
              </div>
              <div className="form-field">
                <label htmlFor="loose-note">Note (optional)</label>
                <input id="loose-note" name="note" maxLength={MAX_NOTE_LENGTH} />
              </div>
              <SubmitButton className="btn btn-primary" pendingLabel="Saving…">
                Record Payment
              </SubmitButton>
            </ActionForm>
          </div>
        </CollapsibleGroup>
      )}

      {methodsInUse.map((method) => {
        const totals = s.byMethod[method];
        const rows = live.filter((payment) => payment.method === method);
        const label = RAFFLE_METHOD_LABELS[method];
        const unverified = rows.filter((payment) => !payment.verifiedAt);
        const pending = unverified.length;
        return (
          <section key={method} style={{ marginTop: 28 }}>
            <div className="page-head" style={{ marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: 17, marginBottom: 4 }}>{label} Check-Off</h3>
                <p style={{ margin: 0 }}>
                  {formatCents(totals.receivedCents)} recorded · {formatCents(totals.verifiedCents)} verified ·{" "}
                  <strong className={totals.unverifiedCents > 0 ? "balance-negative" : "balance-positive"}>
                    {formatCents(totals.unverifiedCents)} left to verify
                  </strong>
                  {canManage && pending > 0 && <> — {VERIFY_HINT[method]}</>}
                  {!canManage && rows.some(helperCanVoid) && (
                    <> — Marked the wrong person paid? Use Void on a payment you recorded yourself, before an Admin verifies it.</>
                  )}
                </p>
              </div>
              {canManage && pending > 1 && (
                <ActionForm action={verifyAllPaymentsAction}>
                  <input type="hidden" name="raffleId" value={raffle.id} />
                  <input type="hidden" name="method" value={method} />
                  {/*
                   * The exact list (and amounts) this total was added up from:
                   * only these are verified, and only while each still matches
                   * — see verifyAllPaymentsAction.
                   */}
                  {unverified.map((payment) => (
                    <input key={payment.id} type="hidden" name="reviewed" value={`${payment.id}:${payment.amountCents}`} />
                  ))}
                  <ConfirmSubmitButton
                    className="btn btn-quiet btn-small"
                    pendingLabel="Verifying…"
                    message={`Mark all ${pending} remaining ${label} payments (${formatCents(totals.unverifiedCents)}) as verified? Only do this if the total you counted matches.`}
                  >
                    Verify All {pending}
                  </ConfirmSubmitButton>
                </ActionForm>
              )}
            </div>
            <table className="data-table has-popovers">
              <thead>
                <tr>
                  <th>For</th>
                  <th>Amount</th>
                  <th>Paid By</th>
                  <th>Received</th>
                  <th>Verified</th>
                  {(canManage || helperUserId) && <th></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((payment) => {
                  const entry = raffle.entries.find((e) => e.id === payment.entryId);
                  return (
                    <tr key={payment.id} className={payment.verifiedAt ? "status-paid" : undefined}>
                      <td className="audit-hover" data-audit={formatAuditTooltip("Recorded", payment.createdAt, payment.recordedByUsername)}>
                        {entry ? entry.name : `Not matched — ${payment.payerName ?? "unknown"}`}
                        {entry && (
                          <span className="form-note" style={{ display: "block", marginTop: 2, fontWeight: 400 }}>
                            {entry.boxNumbers.length === 1 ? "Box" : "Boxes"} {formatBoxNumbers(entry.boxNumbers)}
                            {payment.note ? ` · ${payment.note}` : ""}
                          </span>
                        )}
                      </td>
                      <td data-label="Amount">{formatCents(payment.amountCents)}</td>
                      <td data-label="Paid By">{payment.payerName ?? "—"}</td>
                      <td data-label="Received">{receivedLabel(payment.receivedOn)}</td>
                      <td data-label="Verified">
                        {payment.verifiedAt ? (
                          <span className="badge-pill badge-paid" title={payment.verifiedByName ? `By ${payment.verifiedByName}` : undefined}>
                            Verified
                          </span>
                        ) : (
                          <span className="badge-pill badge-pending">Not yet</span>
                        )}
                      </td>
                      {canManage && (
                        <td className="actions">
                          <ActionForm action={setPaymentVerifiedAction}>
                            <input type="hidden" name="paymentId" value={payment.id} />
                            <input type="hidden" name="verified" value={String(!payment.verifiedAt)} />
                            {/* What this row showed: a payment corrected since then isn't ticked off. */}
                            <input type="hidden" name="amountCents" value={payment.amountCents} />
                            <input type="hidden" name="method" value={payment.method} />
                            <SubmitButton
                              className={payment.verifiedAt ? "btn btn-quiet btn-small" : "btn btn-primary btn-small"}
                              pendingLabel="Saving…"
                            >
                              {payment.verifiedAt ? "Undo Verify" : "Verify"}
                            </SubmitButton>
                          </ActionForm>
                          {paymentActions(payment)}
                        </td>
                      )}
                      {/* A plain cell when there's no button: an empty flex "actions" cell isn't a table cell, so its border sits out of line with the row. */}
                      {!canManage &&
                        helperUserId &&
                        (helperCanVoid(payment) ? <td className="actions">{voidPopover(payment)}</td> : <td />)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}

      {live.length === 0 && <p style={{ marginTop: 20 }}>No payments recorded yet.</p>}

      {voided.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <CollapsibleGroup label={`Voided Payments (${voided.length})`} defaultOpen={false}>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>For</th>
                    <th>Amount</th>
                    <th>How</th>
                    <th>Voided</th>
                    <th>Why</th>
                    {canManage && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {voided.map((payment) => (
                    <tr key={payment.id} className="raffle-voided">
                      <td>{payment.entryName ?? payment.payerName ?? "Unknown"}</td>
                      <td data-label="Amount" className="raffle-amount">
                        {formatCents(payment.amountCents)}
                      </td>
                      <td data-label="How">{RAFFLE_METHOD_LABELS[payment.method]}</td>
                      <td data-label="Voided">
                        {payment.voidedAt!.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          timeZone: PACK_TIME_ZONE,
                        })}
                        {payment.voidedByName ? ` by ${payment.voidedByName}` : ""}
                      </td>
                      <td data-label="Why">{payment.voidReason ?? "—"}</td>
                      {canManage && (
                        <td className="actions">
                          <ActionForm action={restorePaymentAction}>
                            <input type="hidden" name="paymentId" value={payment.id} />
                            <ConfirmSubmitButton
                              className="btn btn-quiet btn-small"
                              pendingLabel="Restoring…"
                              message={`Restore this ${formatCents(payment.amountCents)} payment? It will count again, as not verified.`}
                            >
                              Restore
                            </ConfirmSubmitButton>
                          </ActionForm>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CollapsibleGroup>
        </div>
      )}
    </>
  );
}
