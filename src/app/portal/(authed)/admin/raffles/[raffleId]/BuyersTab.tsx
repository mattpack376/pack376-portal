import Link from "next/link";
import ActionForm from "@/components/ActionForm";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import EditPopover from "@/components/EditPopover";
import SubmitButton from "@/components/SubmitButton";
import { assignBoxesAction, removeEntryAction, updateEntryAction } from "@/lib/actions/raffles";
import { formatCents } from "@/lib/duesData";
import { paymentRowClass, paymentStatus } from "@/lib/paymentStatus";
import { RAFFLE_METHODS, RAFFLE_METHOD_LABELS, formatBoxNumbers } from "@/lib/raffleMath";
import type { RaffleDetail } from "@/lib/raffleData";
import { PayerNameList, RecordPaymentPopover } from "./parts";

const PAYER_LIST_ID = "buyers-payer-names";

/**
 * Everyone on the raffle: their boxes, what they owe and what they've paid.
 * The search takes a name, a box number, or the name a payment came from.
 */
export default function BuyersTab({
  raffle,
  canEdit,
  boardLocked,
  query,
  today,
  buyerNames,
  payerNames,
}: {
  raffle: RaffleDetail;
  /** Admin on an open raffle. */
  canEdit: boolean;
  /** The winner is recorded, so boxes can't change hands. */
  boardLocked: boolean;
  query: string;
  today: string;
  buyerNames: string[];
  payerNames: string[];
}) {
  const base = `/portal/admin/raffles/${raffle.id}`;
  const q = query.trim();
  const needle = q.toLowerCase();
  const boxNumber = /^\d+$/.test(q) ? Number(q) : null;
  const shown = !q
    ? raffle.entries
    : raffle.entries.filter((entry) =>
        boxNumber !== null
          ? entry.boxNumbers.includes(boxNumber)
          : entry.name.toLowerCase().includes(needle) ||
            (entry.notes ?? "").toLowerCase().includes(needle) ||
            entry.payments.some((payment) => (payment.payerName ?? "").toLowerCase().includes(needle))
      );

  return (
    <>
      <form method="get" style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 20 }}>
        <input type="hidden" name="tab" value="buyers" />
        <div className="form-field" style={{ marginBottom: 0, flex: "1 1 220px", maxWidth: 360 }}>
          <label htmlFor="q">Find a buyer</label>
          <input id="q" name="q" type="search" defaultValue={q} placeholder="Name or box number" />
        </div>
        <button type="submit" className="btn btn-quiet">
          Search
        </button>
        {q && (
          <Link className="btn btn-quiet" href={`${base}?tab=buyers`}>
            Show Everyone
          </Link>
        )}
      </form>

      {canEdit && <PayerNameList id={PAYER_LIST_ID} names={payerNames} />}

      {raffle.entries.length === 0 ? (
        <div className="info-card" style={{ marginBottom: 24 }}>
          <p>No boxes sold yet.</p>
        </div>
      ) : (
        <table className="data-table has-popovers" style={{ marginBottom: 12 }}>
          <thead>
            <tr>
              <th>Buyer</th>
              <th>Boxes</th>
              <th>Cost</th>
              <th>Paid</th>
              <th>Still Owes</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={7}>
                  {boxNumber !== null ? `Nobody has box ${boxNumber}.` : `No buyer matches “${q}”.`}
                </td>
              </tr>
            )}
            {shown.map((entry) => {
              const status = paymentStatus(entry.remainingCents, entry.paidCents);
              const payers = [...new Set(entry.payments.filter((p) => !p.voidedAt && p.payerName).map((p) => p.payerName))];
              return (
                <tr key={entry.id} className={paymentRowClass(entry.remainingCents, entry.paidCents)}>
                  <td>
                    {entry.name}
                    {entry.notes && (
                      <span className="form-note" style={{ display: "block", marginTop: 2, fontWeight: 400 }}>
                        {entry.notes}
                      </span>
                    )}
                    {payers.length > 0 && (
                      <span className="form-note" style={{ display: "block", marginTop: 2, fontWeight: 400 }}>
                        Paid by {payers.join(", ")}
                      </span>
                    )}
                  </td>
                  <td data-label="Boxes">{formatBoxNumbers(entry.boxNumbers)}</td>
                  <td data-label="Cost">{formatCents(entry.owedCents)}</td>
                  <td data-label="Paid">{formatCents(entry.paidCents)}</td>
                  <td data-label="Still Owes">{formatCents(Math.max(entry.remainingCents, 0))}</td>
                  <td data-label="Status">
                    <span className={`badge-pill ${status.cls}`}>{status.label}</span>
                  </td>
                  <td className="actions">
                    {canEdit && (
                      <>
                        <RecordPaymentPopover
                          raffleId={raffle.id}
                          entry={entry}
                          today={today}
                          idPrefix="buyer-pay"
                          payerListId={PAYER_LIST_ID}
                        />
                        <EditPopover action={updateEntryAction}>
                          <input type="hidden" name="entryId" value={entry.id} />
                          <div className="form-field">
                            <label htmlFor={`entry-${entry.id}-name`}>Name</label>
                            <input id={`entry-${entry.id}-name`} name="name" required defaultValue={entry.name} />
                          </div>
                          <div className="form-field">
                            <label htmlFor={`entry-${entry.id}-boxes`}>Boxes</label>
                            <input
                              id={`entry-${entry.id}-boxes`}
                              name="boxes"
                              inputMode="numeric"
                              required
                              readOnly={boardLocked}
                              defaultValue={formatBoxNumbers(entry.boxNumbers)}
                            />
                            <p className="form-note" style={{ marginTop: 0 }}>
                              {boardLocked
                                ? "Locked — the winner is recorded."
                                : "Separate with commas. Adding or taking away a box changes what they owe."}
                            </p>
                          </div>
                          <div className="form-field">
                            <label htmlFor={`entry-${entry.id}-notes`}>Notes (optional)</label>
                            <input id={`entry-${entry.id}-notes`} name="notes" defaultValue={entry.notes ?? ""} />
                          </div>
                          <SubmitButton className="btn btn-primary btn-small" pendingLabel="Saving…">
                            Save
                          </SubmitButton>
                        </EditPopover>
                        {/* A buyer with money recorded can't be removed — see removeEntryAction. */}
                        {!boardLocked && entry.paidCents === 0 && (
                          <ActionForm action={removeEntryAction}>
                            <input type="hidden" name="entryId" value={entry.id} />
                            <ConfirmSubmitButton
                              className="btn btn-danger btn-small"
                              pendingLabel="Removing…"
                              message={`Remove ${entry.name} from this raffle? ${entry.boxNumbers.length === 1 ? "Box" : "Boxes"} ${formatBoxNumbers(entry.boxNumbers)} will be open again. This can't be undone.`}
                            >
                              Remove
                            </ConfirmSubmitButton>
                          </ActionForm>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {raffle.entries.length > 0 && (
        <p className="form-note" style={{ marginBottom: 28 }}>
          {q ? `Showing ${shown.length} of ${raffle.entries.length} buyers.` : `${raffle.entries.length} buyers.`}
          {canEdit && " To take someone off the raffle, void their payments first (Payments tab), then Remove appears here."}
        </p>
      )}

      {canEdit && !boardLocked && (
        <div className="info-card" style={{ maxWidth: 560 }}>
          <h3>Add a Buyer by Box Number</h3>
          <p>
            The same as picking boxes on the Board tab, for when it&apos;s quicker to type the numbers. A name
            that&apos;s already on this raffle gets the extra boxes.
          </p>
          <ActionForm action={assignBoxesAction}>
            <input type="hidden" name="raffleId" value={raffle.id} />
            <div className="form-row">
              <div className="form-field">
                <label htmlFor="add-name">Buyer</label>
                <input id="add-name" name="name" list="add-buyer-names" autoComplete="off" required placeholder="Name" />
                <datalist id="add-buyer-names">
                  {[...new Set([...raffle.entries.map((entry) => entry.name), ...buyerNames])].map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
              <div className="form-field">
                <label htmlFor="add-boxes">Boxes</label>
                <input id="add-boxes" name="boxes" inputMode="numeric" required placeholder="e.g. 12, 15, 18" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-field">
                <label htmlFor="add-paid">Paid?</label>
                <select id="add-paid" name="paid" defaultValue="">
                  <option value="">Not yet — owes it</option>
                  {RAFFLE_METHODS.map((method) => (
                    <option key={method} value={method}>
                      Yes — {RAFFLE_METHOD_LABELS[method]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="add-payer">Paid by someone else? (optional)</label>
                <input id="add-payer" name="payerName" list={PAYER_LIST_ID} autoComplete="off" placeholder="Name on the Zelle" />
              </div>
            </div>
            <SubmitButton className="btn btn-primary" pendingLabel="Saving…">
              Add Buyer
            </SubmitButton>
          </ActionForm>
        </div>
      )}
    </>
  );
}
