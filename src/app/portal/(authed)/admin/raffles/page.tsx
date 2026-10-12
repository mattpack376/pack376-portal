import Link from "next/link";
import { requireRafflesViewSession } from "@/lib/authorize";
import { getRaffles, type RaffleListItem } from "@/lib/raffleData";
import { formatCents } from "@/lib/duesData";
import { formatLongDate } from "@/lib/dateOnly";
import { MAX_RAFFLE_BOXES } from "@/lib/raffleMath";
import { createRaffleAction, importRaffleAction } from "@/lib/actions/raffles";
import ActionForm from "@/components/ActionForm";
import SubmitButton from "@/components/SubmitButton";
import CollapsibleGroup from "@/components/CollapsibleGroup";

function drawingLabel(raffle: RaffleListItem) {
  return raffle.drawingDate ? formatLongDate(raffle.drawingDate) : "Not set";
}

export default async function AdminRafflesPage() {
  // Junior Admin reads every raffle; only an Admin starts, runs or imports one.
  const session = await requireRafflesViewSession();
  const canEdit = session.role === "ADMIN";

  const raffles = await getRaffles();
  const open = raffles.filter((raffle) => raffle.status === "OPEN");
  const past = raffles.filter((raffle) => raffle.status === "CLOSED");
  const raisedCents = past.reduce((sum, raffle) => sum + raffle.summary.netCents, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Money</div>
          <h2>50/50 Raffles</h2>
          <p>
            Run a numbered-board raffle: who has which box, who has paid and how, and what the winner and the pack each
            get. Closed raffles stay here as a permanent record.
          </p>
        </div>
      </div>

      <h3 style={{ fontSize: 17, margin: "0 0 14px" }}>Open Raffles</h3>
      {open.length === 0 ? (
        <div className="info-card" style={{ marginBottom: 32 }}>
          <p>{canEdit ? "No raffle is running right now — start one below." : "No raffle is running right now."}</p>
        </div>
      ) : (
        <div className="table-scroll" style={{ marginBottom: 32 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Raffle</th>
                <th>Drawing</th>
                <th>Boxes Sold</th>
                <th>Collected</th>
                <th>Still Owed</th>
                <th>Prize</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {open.map((raffle) => (
                <tr key={raffle.id}>
                  <td>{raffle.name}</td>
                  <td data-label="Drawing">{drawingLabel(raffle)}</td>
                  <td data-label="Boxes Sold">
                    {raffle.summary.soldBoxes} of {raffle.boxCount}
                  </td>
                  <td data-label="Collected">{formatCents(raffle.summary.collectedCents)}</td>
                  <td data-label="Still Owed" className={raffle.summary.outstandingCents > 0 ? "balance-negative" : undefined}>
                    {formatCents(raffle.summary.outstandingCents)}
                  </td>
                  <td data-label="Prize">
                    {formatCents(raffle.summary.prizeCents)}
                    {!raffle.summary.prizeIsFinal && " so far"}
                  </td>
                  <td className="actions">
                    <Link className="btn btn-quiet btn-small" href={`/portal/admin/raffles/${raffle.id}`}>
                      {canEdit ? "Manage" : "View"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ fontSize: 17, margin: "0 0 14px" }}>Past Raffles</h3>
      {past.length === 0 ? (
        <div className="info-card" style={{ marginBottom: 32 }}>
          <p>No closed raffles yet. A raffle moves here when it&apos;s closed out.</p>
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Raffle</th>
                  <th>Drawing</th>
                  <th>Boxes Sold</th>
                  <th>Collected</th>
                  <th>Prize</th>
                  <th>Pack Kept</th>
                  <th>Winner</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {past.map((raffle) => (
                  <tr key={raffle.id}>
                    <td>{raffle.name}</td>
                    <td data-label="Drawing">{drawingLabel(raffle)}</td>
                    <td data-label="Boxes Sold">
                      {raffle.summary.soldBoxes} of {raffle.boxCount}
                    </td>
                    <td data-label="Collected">{formatCents(raffle.summary.collectedCents)}</td>
                    <td data-label="Prize">{formatCents(raffle.summary.prizeCents)}</td>
                    <td data-label="Pack Kept">{formatCents(raffle.summary.netCents)}</td>
                    <td data-label="Winner">
                      {raffle.winningBox === null ? "—" : `${raffle.winnerName} (box ${raffle.winningBox})`}
                    </td>
                    <td className="actions">
                      <Link className="btn btn-quiet btn-small" href={`/portal/admin/raffles/${raffle.id}`}>
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="form-note" style={{ marginBottom: 32 }}>
            {past.length} closed raffle{past.length === 1 ? "" : "s"} — {formatCents(raisedCents)} kept by the pack in all.
          </p>
        </>
      )}

      {canEdit && (
        <>
          <div className="info-card" style={{ maxWidth: 460, marginBottom: 24 }}>
            <h3>Start a New Raffle</h3>
            <ActionForm action={createRaffleAction}>
              <div className="form-field">
                <label htmlFor="name">Name</label>
                <input id="name" name="name" required placeholder="e.g. Blue & Gold 50/50" />
              </div>
              <div className="form-row">
                <div className="form-field">
                  <label htmlFor="drawingDate">Drawing Date (optional)</label>
                  <input id="drawingDate" name="drawingDate" type="date" />
                </div>
                <div className="form-field">
                  <label htmlFor="boxCount">Number of Boxes</label>
                  <input id="boxCount" name="boxCount" type="number" min="1" max={MAX_RAFFLE_BOXES} step="1" required defaultValue="100" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-field">
                  <label htmlFor="price">Price Per Box ($)</label>
                  <input id="price" name="price" type="number" min="0.01" step="0.01" required defaultValue="10" />
                </div>
                <div className="form-field">
                  <label htmlFor="prizePercent">Winner&apos;s Share (%)</label>
                  <input id="prizePercent" name="prizePercent" type="number" min="0" max="100" step="1" required defaultValue="50" />
                </div>
              </div>
              <div className="form-field">
                <label htmlFor="notes">Notes (optional)</label>
                <textarea id="notes" name="notes" rows={2} />
              </div>
              <SubmitButton className="btn btn-primary" pendingLabel="Starting…">
                Start Raffle
              </SubmitButton>
            </ActionForm>
          </div>

          <CollapsibleGroup label="Import a Past Raffle" defaultOpen={false}>
            <div className="info-card" style={{ maxWidth: 460, marginTop: 10 }}>
              <p>
                For a raffle that was already run before this page existed. Choose its record file and the whole raffle
                — buyers, boxes, payments and the winner — is added as one finished record.
              </p>
              <ActionForm action={importRaffleAction}>
                <div className="form-field">
                  <label htmlFor="file">Raffle Record File</label>
                  <input id="file" name="file" type="file" accept=".json,application/json" required />
                </div>
                <SubmitButton className="btn btn-quiet" pendingLabel="Importing…">
                  Import Raffle
                </SubmitButton>
              </ActionForm>
            </div>
          </CollapsibleGroup>
        </>
      )}
    </>
  );
}
