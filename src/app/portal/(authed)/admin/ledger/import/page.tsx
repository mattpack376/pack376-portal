import { requireLedgerSession } from "@/lib/authorize";
import { getLedgerCategories, getLedgerSettings } from "@/lib/ledgerData";
import { getLedgerImportBatches, getLedgerImportTabs } from "@/lib/ledgerImportData";
import { getLedgerSyncView } from "@/lib/ledgerSync";
import { formatLongDate } from "@/lib/dateOnly";
import { formatPackDateTime } from "@/lib/bannerSchedule";
import { formatCents } from "@/lib/duesData";
import { updateLedgerSettingsAction } from "@/lib/actions/ledger";
import { undoLedgerImportAction } from "@/lib/actions/ledgerImport";
import LedgerSubNav from "@/components/LedgerSubNav";
import LedgerSyncStatus from "@/components/LedgerSyncStatus";
import LedgerImportFlow from "@/components/LedgerImportFlow";
import ActionForm from "@/components/ActionForm";
import SubmitButton from "@/components/SubmitButton";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";

// Server Actions on this page take their time limit from here (the import reads the Sheet; the Sheet sync runs after a save).
export const maxDuration = 60;

/**
 * The Ledger's settings and the one-time import of the treasurer's Google
 * Sheet rows: preview, confirm, and the import history with Undo.
 */
export default async function LedgerImportPage() {
  await requireLedgerSession();
  const [settings, syncView, batches, categories] = await Promise.all([
    getLedgerSettings(),
    getLedgerSyncView({ nudge: true }),
    getLedgerImportBatches(),
    getLedgerCategories(),
  ]);
  const active = batches.find((batch) => !batch.undoneAt) ?? null;
  // Google's tab list is only fetched while there's something to import.
  const tabs = active ? null : await getLedgerImportTabs();

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Money</div>
          <h2>Import &amp; Settings</h2>
        </div>
      </div>

      <LedgerSubNav active="import" />

      <LedgerSyncStatus view={syncView} />

      {active ? (
        <div className="info-card" style={{ marginBottom: 24 }}>
          <h3>Sheet Imported</h3>
          <p>
            {active.rowCount === 1 ? "1 line" : `${active.rowCount} lines`} came in from the {active.sourceLabel} on{" "}
            {formatPackDateTime(active.importedAt)} ({active.importedByName}).
          </p>
          {settings.cutoverDate && (
            <p>
              <strong>Cutover date: {formatLongDate(settings.cutoverDate)}.</strong>{" "}
              <span className="form-note">
                Lines dated before it came from the Sheet; from that day on, the ledger is kept here. To change it,
                undo the import below and import again.
              </span>
            </p>
          )}
        </div>
      ) : (
        tabs && (
          <LedgerImportFlow
            configured={tabs.configured}
            tabs={tabs.tabs}
            defaultTab={tabs.defaultTab}
            tabsError={tabs.error}
            categories={categories.map((c) => ({ id: c.id, name: c.name, archived: c.archived }))}
          />
        )
      )}

      {batches.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3>Import History</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Imported</th>
                <th>Source</th>
                <th>Lines</th>
                <th>Money In</th>
                <th>Money Out</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <tr key={batch.id}>
                  <td>
                    {formatPackDateTime(batch.importedAt)}
                    <span className="form-note" style={{ display: "block", marginTop: 2 }}>
                      by {batch.importedByName}
                    </span>
                  </td>
                  <td data-label="Source">{batch.sourceLabel}</td>
                  <td data-label="Lines">{batch.rowCount}</td>
                  <td data-label="Money In">{formatCents(batch.inflowCents)}</td>
                  <td data-label="Money Out">{formatCents(batch.outflowCents)}</td>
                  <td data-label="Status">
                    {batch.undoneAt ? (
                      <span className="badge-pill badge-pending">
                        Undone {formatPackDateTime(batch.undoneAt)}
                        {batch.undoneByName ? ` by ${batch.undoneByName}` : ""}
                      </span>
                    ) : (
                      <span className="badge-pill badge-paid">In the ledger</span>
                    )}
                  </td>
                  <td className="actions">
                    {!batch.undoneAt && (
                      <form action={undoLedgerImportAction}>
                        <input type="hidden" name="id" value={batch.id} />
                        <ConfirmSubmitButton
                          className="btn btn-danger btn-small"
                          pendingLabel="Undoing…"
                          message={`Undo the import from the ${batch.sourceLabel}? Its ${batch.liveCount === 1 ? "line comes" : `${batch.liveCount} lines come`} off the ledger (kept as deleted) and the cutover date is cleared, so the tab can be imported again.`}
                        >
                          Undo Import
                        </ConfirmSubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="info-card" style={{ maxWidth: 560 }}>
        <h3>Google Sheet Copy</h3>
        <p>
          The portal keeps a copy of the ledger in its own tab of the pack&apos;s Google Sheet, and never changes any
          other tab. Turn it off to stop the portal writing to the Sheet — while you rearrange the Sheet, say. The
          ledger here is unaffected either way.
        </p>
        <p style={{ fontWeight: 700 }}>The copy is {settings.syncEnabled ? "on" : "off"}.</p>
        <ActionForm action={updateLedgerSettingsAction}>
          <input type="hidden" name="syncEnabled" value={settings.syncEnabled ? "false" : "true"} />
          <SubmitButton className={settings.syncEnabled ? "btn btn-quiet" : "btn btn-primary"} pendingLabel="Saving…">
            {settings.syncEnabled ? "Turn the Sheet Copy Off" : "Turn the Sheet Copy On"}
          </SubmitButton>
        </ActionForm>
      </div>
    </>
  );
}
