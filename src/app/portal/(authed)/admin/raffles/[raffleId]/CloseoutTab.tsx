import ActionForm from "@/components/ActionForm";
import CollapsibleGroup from "@/components/CollapsibleGroup";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import FileExportButton from "@/components/FileExportButton";
import SubmitButton from "@/components/SubmitButton";
import {
  clearWinnerAction,
  closeRaffleAction,
  deleteRaffleAction,
  recordWinnerAction,
  setPrizePaidAction,
  updateRaffleAction,
} from "@/lib/actions/raffles";
import { auditDate } from "@/lib/audit";
import { toDateOnlyString } from "@/lib/dateOnly";
import { formatCents } from "@/lib/duesData";
import { MAX_RAFFLE_BOXES, RAFFLE_METHOD_LABELS } from "@/lib/raffleMath";
import type { RaffleDetail } from "@/lib/raffleData";
import { MethodSelect } from "./parts";

/**
 * The end of a raffle, in the order it happens: record the drawing, pay the
 * winner, check nothing is left open, download the records, close it.
 */
export default function CloseoutTab({
  raffle,
  isAdmin,
  isMasterAdmin,
  today,
}: {
  raffle: RaffleDetail;
  isAdmin: boolean;
  isMasterAdmin: boolean;
  today: string;
}) {
  const s = raffle.summary;
  const isOpen = raffle.status === "OPEN";
  const canEdit = isAdmin && isOpen;
  const hasWinner = raffle.winningBox !== null;
  const winningEntry = hasWinner ? raffle.entries.find((entry) => entry.boxNumbers.includes(raffle.winningBox!)) : undefined;
  const exportBase = `/portal/admin/raffles/${raffle.id}/export`;

  // What a careful close-out would want settled first. None of it blocks
  // closing — a raffle with an IOU that will never be paid still has to end.
  const loose: string[] = [];
  if (!hasWinner) loose.push("no winner is recorded");
  if (hasWinner && !raffle.prizePaid) loose.push(`the ${formatCents(s.prizeCents)} prize isn't marked as paid`);
  if (s.outstandingCents > 0) loose.push(`${formatCents(s.outstandingCents)} is still owed by buyers`);
  if (s.unmatchedCents > 0) loose.push(`${formatCents(s.unmatchedCents)} isn't matched to a buyer`);
  if (s.unverifiedCents > 0) loose.push(`${formatCents(s.unverifiedCents)} received hasn't been verified`);

  return (
    <>
      <div className="card-row">
        <div className="info-card">
          <h3>The Drawing</h3>
          {hasWinner ? (
            <>
              <p style={{ fontSize: 28, fontWeight: 700, color: "var(--scout-blue)", margin: 0 }}>Box {raffle.winningBox}</p>
              <p>
                Winner: <strong>{raffle.winnerName}</strong>
                {winningEntry && winningEntry.name !== raffle.winnerName && <> · box bought by {winningEntry.name}</>}
                <br />
                Prize: <strong>{formatCents(s.prizeCents)}</strong> ({raffle.prizePercent}% of {s.soldBoxes} boxes sold)
              </p>
              {canEdit && (
                <form action={clearWinnerAction}>
                  <input type="hidden" name="raffleId" value={raffle.id} />
                  <ConfirmSubmitButton
                    className="btn btn-quiet btn-small"
                    pendingLabel="Clearing…"
                    message={`Clear the recorded winner (box ${raffle.winningBox}, ${raffle.winnerName})? The prize amount and its paid status are cleared too, and the board unlocks.`}
                  >
                    Clear Winner
                  </ConfirmSubmitButton>
                </form>
              )}
            </>
          ) : (
            <>
              <p>
                Not drawn yet. The prize stands at <strong>{formatCents(s.prizeCents)}</strong> — {raffle.prizePercent}% of the{" "}
                {s.soldBoxes} boxes sold — and is fixed at that the moment the winner is recorded.
              </p>
              {s.unpaidBoxes > 0 && (
                <p className="balance-negative" style={{ fontWeight: 600 }}>
                  {s.unpaidBoxes} sold {s.unpaidBoxes === 1 ? "box isn't" : "boxes aren't"} fully paid for yet (
                  {formatCents(s.outstandingCents)} owed). They still count toward the prize.
                </p>
              )}
              {canEdit && (
                <ActionForm action={recordWinnerAction}>
                  <input type="hidden" name="raffleId" value={raffle.id} />
                  <div className="form-row">
                    <div className="form-field">
                      <label htmlFor="winningBox">Winning Box</label>
                      <input id="winningBox" name="winningBox" type="number" min="1" max={raffle.boxCount} step="1" required />
                    </div>
                    <div className="form-field">
                      <label htmlFor="winnerName">Winner&apos;s Name (optional)</label>
                      <input id="winnerName" name="winnerName" placeholder="Blank = the box's buyer" />
                    </div>
                  </div>
                  <p className="form-note" style={{ marginTop: 0, marginBottom: 14 }}>
                    Recording the winner locks the board, so boxes can&apos;t change afterwards. Payments can still be
                    collected.
                  </p>
                  <SubmitButton className="btn btn-primary" pendingLabel="Saving…">
                    Record Winner
                  </SubmitButton>
                </ActionForm>
              )}
            </>
          )}
        </div>

        <div className="info-card">
          <h3>Prize Payout</h3>
          {!hasWinner ? (
            <p>Record the winner first.</p>
          ) : (
            <>
              <p>
                <span className={`badge-pill ${raffle.prizePaid ? "badge-paid" : "badge-unpaid"}`}>
                  {raffle.prizePaid ? "Paid" : "Not paid yet"}
                </span>{" "}
                {formatCents(s.prizeCents)} to {raffle.winnerName}
                {raffle.prizePaid && (
                  <>
                    <br />
                    {raffle.prizePaidOn ? `Paid ${auditDate(raffle.prizePaidOn)}` : "Date paid not recorded"}
                    {raffle.prizePaidMethod ? ` by ${RAFFLE_METHOD_LABELS[raffle.prizePaidMethod].toLowerCase()}` : " · how it was paid not recorded"}
                  </>
                )}
              </p>
              {canEdit && (
                <ActionForm action={setPrizePaidAction}>
                  <input type="hidden" name="raffleId" value={raffle.id} />
                  <div className="form-field">
                    <label htmlFor="prizePaid">Has the winner been paid?</label>
                    <select id="prizePaid" name="prizePaid" defaultValue={String(raffle.prizePaid)}>
                      <option value="false">Not yet</option>
                      <option value="true">Yes — paid</option>
                    </select>
                  </div>
                  <div className="form-row">
                    <div className="form-field">
                      <label htmlFor="prizePaidOn">Date Paid</label>
                      <input
                        id="prizePaidOn"
                        name="prizePaidOn"
                        type="date"
                        defaultValue={toDateOnlyString(raffle.prizePaidOn) ?? (raffle.prizePaid ? "" : today)}
                      />
                    </div>
                    <div className="form-field">
                      <label htmlFor="prizePaidMethod">How</label>
                      <MethodSelect id="prizePaidMethod" name="prizePaidMethod" defaultValue={raffle.prizePaidMethod} blankLabel="Not recorded" />
                    </div>
                  </div>
                  <SubmitButton className="btn btn-quiet" pendingLabel="Saving…">
                    Save Payout
                  </SubmitButton>
                </ActionForm>
              )}
            </>
          )}
        </div>
      </div>

      <div className="card-row">
        <div className="info-card">
          <h3>Final Numbers</h3>
          <dl className="raffle-ledger">
            <div>
              <dt>
                Boxes sold
                <small>
                  {s.soldBoxes} of {s.boxCount} · {s.availableBoxes} unsold
                </small>
              </dt>
              <dd>{formatCents(s.salesCents)}</dd>
            </div>
            <div>
              <dt>Collected</dt>
              <dd>{formatCents(s.collectedCents)}</dd>
            </div>
            <div>
              <dt>Still owed by buyers</dt>
              <dd className={s.outstandingCents > 0 ? "balance-negative" : undefined}>{formatCents(s.outstandingCents)}</dd>
            </div>
            <div>
              <dt>{s.prizeIsFinal ? (raffle.prizePaid ? "Prize paid to winner" : "Prize owed to winner") : "Prize so far"}</dt>
              <dd>{formatCents(s.prizeCents)}</dd>
            </div>
            <div className="is-total">
              <dt>Pack proceeds</dt>
              <dd className={s.netCents < 0 ? "balance-negative" : undefined}>{formatCents(s.netCents)}</dd>
            </div>
          </dl>
        </div>

        {isAdmin && (
          <div className="info-card">
            <h3>Download the Records</h3>
            <p>Spreadsheet files (CSV) that open in Excel, Numbers or Google Sheets.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
              <FileExportButton className="btn btn-quiet btn-small" href={`${exportBase}?type=summary`} label="Financial Report" />
              <FileExportButton className="btn btn-quiet btn-small" href={`${exportBase}?type=boxes`} label="Box Assignments (Every Box)" />
              <FileExportButton className="btn btn-quiet btn-small" href={`${exportBase}?type=payments`} label="Payments & Reconciliation" />
            </div>
          </div>
        )}
      </div>

      {canEdit && (
        <div className="info-card" style={{ marginBottom: 24 }}>
          <h3>Close This Raffle</h3>
          {loose.length === 0 ? (
            <p>Everything is settled: the winner is paid, every buyer has paid, and all the money is verified.</p>
          ) : (
            <>
              <p style={{ marginBottom: 6 }}>Still open:</p>
              <ul style={{ marginTop: 0 }}>
                {loose.map((item) => (
                  <li key={item}>{item.charAt(0).toUpperCase() + item.slice(1)}.</li>
                ))}
              </ul>
            </>
          )}
          <p>
            Closing moves the raffle to Past Raffles and makes it read-only, so the record can&apos;t be changed by
            accident. An Admin can reopen it.
          </p>
          <form action={closeRaffleAction}>
            <input type="hidden" name="raffleId" value={raffle.id} />
            <ConfirmSubmitButton
              className="btn btn-primary"
              pendingLabel="Closing…"
              message={
                loose.length === 0
                  ? `Close “${raffle.name}”? It becomes a read-only record.`
                  : `Close “${raffle.name}” even though ${loose.join(", and ")}? It becomes a read-only record; an Admin can reopen it.`
              }
            >
              Close Raffle
            </ConfirmSubmitButton>
          </form>
        </div>
      )}

      {canEdit && (
        <CollapsibleGroup label="Raffle Settings" defaultOpen={false}>
          <div className="info-card" style={{ maxWidth: 460, marginTop: 10, marginBottom: 24 }}>
            <ActionForm action={updateRaffleAction}>
              <input type="hidden" name="raffleId" value={raffle.id} />
              <div className="form-field">
                <label htmlFor="edit-name">Name</label>
                <input id="edit-name" name="name" required defaultValue={raffle.name} />
              </div>
              <div className="form-row">
                <div className="form-field">
                  <label htmlFor="edit-drawingDate">Drawing Date</label>
                  <input id="edit-drawingDate" name="drawingDate" type="date" defaultValue={toDateOnlyString(raffle.drawingDate) ?? ""} />
                </div>
                <div className="form-field">
                  <label htmlFor="edit-boxCount">Number of Boxes</label>
                  <input
                    id="edit-boxCount"
                    name="boxCount"
                    type="number"
                    min="1"
                    max={MAX_RAFFLE_BOXES}
                    step="1"
                    required
                    defaultValue={raffle.boxCount}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-field">
                  <label htmlFor="edit-price">Price Per Box ($)</label>
                  <input id="edit-price" name="price" type="number" min="0.01" step="0.01" required defaultValue={(raffle.priceCents / 100).toFixed(2)} />
                </div>
                <div className="form-field">
                  <label htmlFor="edit-prizePercent">Winner&apos;s Share (%)</label>
                  <input id="edit-prizePercent" name="prizePercent" type="number" min="0" max="100" step="1" required defaultValue={raffle.prizePercent} />
                </div>
              </div>
              <div className="form-field">
                <label htmlFor="edit-notes">Notes (optional)</label>
                <textarea id="edit-notes" name="notes" rows={3} defaultValue={raffle.notes ?? ""} />
              </div>
              <p className="form-note" style={{ marginTop: 0, marginBottom: 14 }}>
                The price can&apos;t change once a payment is recorded, and neither it nor the winner&apos;s share can
                change once the winner is recorded.
              </p>
              <SubmitButton className="btn btn-primary" pendingLabel="Saving…">
                Save Settings
              </SubmitButton>
            </ActionForm>
          </div>
        </CollapsibleGroup>
      )}

      {isMasterAdmin && (
        <CollapsibleGroup label="Delete This Raffle" defaultOpen={false}>
          <div className="info-card" style={{ maxWidth: 460, marginTop: 10 }}>
            <p>
              Deletes the raffle with every buyer, box and payment in it. Only for one created by mistake — a finished
              raffle should be closed, not deleted.
            </p>
            <form action={deleteRaffleAction}>
              <input type="hidden" name="raffleId" value={raffle.id} />
              <ConfirmSubmitButton
                className="btn btn-danger btn-small"
                pendingLabel="Deleting…"
                message={`Delete “${raffle.name}” and all ${raffle.entries.length} buyers, ${s.soldBoxes} boxes and ${raffle.payments.length} payments in it? This can't be undone.`}
              >
                Delete Raffle
              </ConfirmSubmitButton>
            </form>
          </div>
        </CollapsibleGroup>
      )}
    </>
  );
}
