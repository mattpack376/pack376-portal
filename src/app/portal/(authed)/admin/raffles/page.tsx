import Link from "next/link";
import { RAFFLE_HELPER_ROLES, requireRaffleAccess } from "@/lib/authorize";
import { getRaffleHelperCandidates, getRaffles, type RaffleListItem } from "@/lib/raffleData";
import { ROLE_BADGE_CLASSES, ROLE_LABELS } from "@/lib/roleLabels";
import { formatCents } from "@/lib/duesData";
import { formatLongDate } from "@/lib/dateOnly";
import { MAX_RAFFLE_BOXES } from "@/lib/raffleMath";
import { createRaffleAction, importRaffleAction, setRaffleHelperAction } from "@/lib/actions/raffles";
import ActionForm from "@/components/ActionForm";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import SubmitButton from "@/components/SubmitButton";
import CollapsibleGroup from "@/components/CollapsibleGroup";

function drawingLabel(raffle: RaffleListItem) {
  return raffle.drawingDate ? formatLongDate(raffle.drawingDate) : "Not set";
}

export default async function AdminRafflesPage() {
  // Only an Admin starts or imports a raffle and decides who the helpers are.
  // A Raffle Helper works the ones that are open; a Junior Admin just reads.
  const { access } = await requireRaffleAccess();
  const canEdit = access === "admin";
  const openLabel = access === "admin" ? "Manage" : access === "helper" ? "Open" : "View";

  const raffles = await getRaffles();
  const candidates = canEdit ? await getRaffleHelperCandidates() : [];
  const helpers = candidates.filter((user) => user.raffleHelper);
  const notHelpers = candidates.filter((user) => !user.raffleHelper);
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
                      {openLabel}
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

          <div className="info-card" style={{ maxWidth: 620, marginBottom: 24 }}>
            <h3>Raffle Helpers</h3>
            <p>
              People you want working a raffle with you, without making them Admins. A helper can open the raffles,
              sell boxes, fix a buyer or take away a box picked by mistake, and mark a buyer as paid. If they mark the
              wrong person paid, they can void that entry themselves until an Admin verifies it.
            </p>
            <p>
              A helper can&apos;t start, close or delete a raffle, verify payments, change a payment or void someone
              else&apos;s, record the winner, or download the records.
            </p>
            {helpers.length === 0 ? (
              <p>
                <strong>No helpers yet.</strong>
              </p>
            ) : (
              <table className="data-table" style={{ marginBottom: 20, boxShadow: "none", border: "1.5px solid var(--cream-dark)" }}>
                <thead>
                  <tr>
                    <th>Helper</th>
                    <th>Login</th>
                    <th>Level</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {helpers.map((user) => (
                    <tr key={user.id}>
                      <td>{user.displayName}</td>
                      <td data-label="Login">{user.username}</td>
                      <td data-label="Level">
                        <span className={`badge-pill ${ROLE_BADGE_CLASSES[user.role]}`}>{ROLE_LABELS[user.role]}</span>
                      </td>
                      <td className="actions">
                        <ActionForm action={setRaffleHelperAction}>
                          <input type="hidden" name="userId" value={user.id} />
                          <input type="hidden" name="enabled" value="false" />
                          <ConfirmSubmitButton
                            className="btn btn-danger btn-small"
                            pendingLabel="Removing…"
                            message={`Stop ${user.displayName} from helping with raffles? Their login and everything else they can do stays the same.`}
                          >
                            Remove
                          </ConfirmSubmitButton>
                        </ActionForm>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {notHelpers.length === 0 ? (
              <p className="form-note">Every login that can be a helper already is one.</p>
            ) : (
              <ActionForm action={setRaffleHelperAction}>
                <input type="hidden" name="enabled" value="true" />
                <div className="form-field">
                  <label htmlFor="helper-user">Add a helper</label>
                  <select id="helper-user" name="userId" required defaultValue="">
                    <option value="" disabled>
                      Pick a login…
                    </option>
                    {RAFFLE_HELPER_ROLES.map((role) => {
                      const users = notHelpers.filter((user) => user.role === role);
                      if (users.length === 0) return null;
                      return (
                        <optgroup key={role} label={ROLE_LABELS[role]}>
                          {users.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.displayName} ({user.username})
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                  <p className="form-note" style={{ marginTop: 0 }}>
                    Anyone with a portal login below Admin, parents included. Admins already have full access.
                  </p>
                </div>
                <SubmitButton className="btn btn-quiet" pendingLabel="Adding…">
                  Add Helper
                </SubmitButton>
              </ActionForm>
            )}
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
