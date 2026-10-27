import Link from "next/link";
import ActionForm from "@/components/ActionForm";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import EditPopover from "@/components/EditPopover";
import SubmitButton from "@/components/SubmitButton";
import RaffleBoxesSaveButton from "@/components/RaffleBoxesSaveButton";
import { assignBoxesAction, changeEntryBoxesAction, removeEntryAction, updateEntryAction } from "@/lib/actions/raffles";
import { formatCents } from "@/lib/duesData";
import { MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from "@/lib/formValues";
import { paymentRowClass, paymentStatus } from "@/lib/paymentStatus";
import { RAFFLE_METHODS, RAFFLE_METHOD_LABELS, formatBoxNumbers } from "@/lib/raffleMath";
import { entryEditVersion } from "@/lib/raffleEditVersion";
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
  canVoid,
  boardLocked,
  query,
  today,
  buyerNames,
  payerNames,
}: {
  raffle: RaffleDetail;
  /** Admin or Raffle Helper on an open raffle. */
  canEdit: boolean;
  /** Admin on an open raffle — the only one who can void a payment, which is what frees a paid buyer to be removed. */
  canVoid: boolean;
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

  const taken = new Set(raffle.entries.flatMap((entry) => entry.boxNumbers));
  const openBoxes = Array.from({ length: raffle.boxCount }, (_, index) => index + 1).filter((number) => !taken.has(number));

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
                        {!boardLocked && (
                          <EditPopover action={changeEntryBoxesAction} label="Boxes">
                            <input type="hidden" name="entryId" value={entry.id} />
                            {/* The price this page shows: added boxes paid for here are refused if it has changed since. */}
                            <input type="hidden" name="priceCents" value={raffle.priceCents} />
                            <div className="form-field">
                              <label>Take away a box picked by mistake</label>
                              <div className="raffle-ticks">
                                {entry.boxNumbers.map((number) => (
                                  <label key={number}>
                                    <input type="checkbox" name="remove" value={number} />
                                    {number}
                                  </label>
                                ))}
                              </div>
                            </div>
                            <div className="form-field">
                              <label htmlFor={`entry-${entry.id}-add`}>Add boxes</label>
                              <input
                                id={`entry-${entry.id}-add`}
                                name="add"
                                autoComplete="off"
                                autoCapitalize="off"
                                autoCorrect="off"
                                spellCheck={false}
                                placeholder="e.g. 12, 15"
                              />
                              {/*
                               * No inputMode="numeric" on this field: an iPhone then shows the
                               * digits-only keypad, which has no comma or space to put between
                               * two box numbers.
                               */}
                              <p className="form-note" style={{ marginTop: 0 }}>
                                Separate more than one with a comma or a space.{" "}
                                {openBoxes.length === 0
                                  ? "The board is sold out."
                                  : openBoxes.length <= 30
                                    ? `Open: ${formatBoxNumbers(openBoxes)}`
                                    : `${openBoxes.length} boxes are open — see the Board tab.`}
                              </p>
                            </div>
                            <div className="form-field">
                              <label htmlFor={`entry-${entry.id}-paid`}>Paid for the added boxes?</label>
                              <select id={`entry-${entry.id}-paid`} name="paid" defaultValue="">
                                <option value="">Not yet — owes it</option>
                                {RAFFLE_METHODS.map((method) => (
                                  <option key={method} value={method}>
                                    Yes — {RAFFLE_METHOD_LABELS[method]}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <p className="form-note" style={{ marginTop: 0 }}>
                              What {entry.name} owes follows the boxes they end up with.
                            </p>
                            <RaffleBoxesSaveButton className="btn btn-primary btn-small" buyerName={entry.name} />
                          </EditPopover>
                        )}
                        <EditPopover action={updateEntryAction}>
                          <input type="hidden" name="entryId" value={entry.id} />
                          {/* What this form was filled in with: refused if someone changes the buyer meanwhile. */}
                          <input type="hidden" name="version" value={entryEditVersion(entry)} />
                          <div className="form-field">
                            <label htmlFor={`entry-${entry.id}-name`}>Name</label>
                            <input id={`entry-${entry.id}-name`} name="name" required maxLength={MAX_NAME_LENGTH} defaultValue={entry.name} />
                          </div>
                          <div className="form-field">
                            <label htmlFor={`entry-${entry.id}-notes`}>Notes (optional)</label>
                            <input id={`entry-${entry.id}-notes`} name="notes" maxLength={MAX_NOTE_LENGTH} defaultValue={entry.notes ?? ""} />
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
          {canEdit &&
            (boardLocked
              ? " Boxes are locked because the winner is recorded. To change one, clear the winner on the Drawing & Close-Out tab first."
              : " Use a buyer's Boxes button to add a box to their line or take away one picked by mistake. " +
                (canVoid
                  ? "To take someone off the raffle, void their payments first (Payments tab), then Remove appears here."
                  : "Remove only shows for a buyer with no payments. You can void a payment you recorded yourself on the Payments tab; an Admin handles the rest."))}
        </p>
      )}

      {canEdit && !boardLocked && (
        <div className="info-card" style={{ maxWidth: 560 }}>
          <h3>Add a New Buyer by Box Number</h3>
          <p>
            For someone who isn&apos;t on the list yet, when it&apos;s quicker to type the numbers than to pick them on
            the Board tab. For someone already above, use their Boxes button instead — though a name typed here that
            matches theirs goes onto their line too, not a second one. Two different people with the same name need
            names that tell them apart, like a last name or initial.
          </p>
          <ActionForm action={assignBoxesAction}>
            <input type="hidden" name="raffleId" value={raffle.id} />
            <input type="hidden" name="priceCents" value={raffle.priceCents} />
            <div className="form-row">
              <div className="form-field">
                <label htmlFor="add-name">Buyer</label>
                <input
                  id="add-name"
                  name="name"
                  list="add-buyer-names"
                  autoComplete="off"
                  required
                  maxLength={MAX_NAME_LENGTH}
                  placeholder="Name"
                />
                <datalist id="add-buyer-names">
                  {[...new Set([...raffle.entries.map((entry) => entry.name), ...buyerNames])].map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
              <div className="form-field">
                <label htmlFor="add-boxes">Boxes</label>
                <input
                  id="add-boxes"
                  name="boxes"
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  placeholder="e.g. 12, 15, 18"
                />
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
                <input
                  id="add-payer"
                  name="payerName"
                  list={PAYER_LIST_ID}
                  autoComplete="off"
                  maxLength={MAX_NAME_LENGTH}
                  placeholder="Name on the Zelle"
                />
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
