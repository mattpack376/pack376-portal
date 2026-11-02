"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  confirmLedgerImportAction,
  previewLedgerImportAction,
  type LedgerImportPreview,
  type LedgerImportPreviewResult,
} from "@/lib/actions/ledgerImport";
import { formatDateOnly } from "@/lib/dateOnly";
import TripAdminForm from "@/components/TripAdminForm";
import CollapsibleGroup from "@/components/CollapsibleGroup";

type PreviewState = LedgerImportPreviewResult & {
  /** The CSV that was previewed, sent again with Confirm so the server reads (and checks) it again. */
  file?: File;
  /** The Sheet tab last previewed, so the picker keeps showing it after React resets the form. */
  tab?: string;
  /** Counts previews, so each new one starts a fresh confirm form. */
  run: number;
};

export type ImportCategoryOption = { id: string; name: string; archived: boolean };

function money(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * The Ledger's one-time import, step by step: pick the Sheet tab (or upload
 * it as a CSV), see what would come in — problems first — then decide where
 * each Sheet category goes, which moves to link and when the portal takes
 * over, and confirm. Nothing is saved until Confirm.
 */
export default function LedgerImportFlow({
  configured,
  tabs,
  defaultTab,
  tabsError,
  categories,
}: {
  configured: boolean;
  tabs: string[];
  defaultTab: string | null;
  tabsError: string | null;
  categories: ImportCategoryOption[];
}) {
  const [state, previewAction, pending] = useActionState(
    async (previous: PreviewState, formData: FormData): Promise<PreviewState> => {
      const file = formData.get("file");
      const tab = formData.get("tab");
      const result = await previewLedgerImportAction(formData);
      return {
        ...result,
        file: file instanceof File && file.size > 0 ? file : undefined,
        tab: typeof tab === "string" ? tab : previous.tab,
        run: previous.run + 1,
      };
    },
    { run: 0 },
  );
  const canReadSheet = configured && tabs.length > 0;

  return (
    <>
      <div className="info-card" style={{ marginBottom: 24 }}>
        <h3>Import the Google Sheet</h3>
        <p>
          Brings the treasurer&apos;s ledger rows into the portal once, so the ledger here starts where the Sheet left
          off. Only the main tab is imported — the event tabs itemize totals that are already on it. You&apos;ll see a
          preview first; nothing is saved until you confirm.
        </p>

        {state.error && (
          <div className="form-error" role="alert">
            {state.error}
          </div>
        )}

        {canReadSheet && (
          <form action={previewAction} className="form-row" style={{ alignItems: "flex-end" }}>
            <input type="hidden" name="source" value="sheet" />
            <div className="form-field">
              <label htmlFor="import-tab">Sheet tab</label>
              {/* Keyed so it remounts showing the tab just previewed: React 19 resets the
                  form after each Preview, which would otherwise jump back to the default. */}
              <select
                key={state.run}
                id="import-tab"
                name="tab"
                defaultValue={(state.tab && tabs.includes(state.tab) ? state.tab : defaultTab) ?? undefined}
              >
                {tabs.map((tab) => (
                  <option key={tab} value={tab}>
                    {tab}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field" style={{ flexGrow: 0, minWidth: 0 }}>
              <button type="submit" className="btn btn-primary" disabled={pending}>
                {pending ? "Reading the Sheet…" : "Preview"}
              </button>
            </div>
          </form>
        )}

        {!configured && (
          <p className="form-note">
            The Google Sheet connection isn&apos;t set up, so the portal can&apos;t read the Sheet directly. Upload the
            tab as a CSV file instead.
          </p>
        )}
        {configured && tabsError && (
          <p className="form-error">
            Couldn&apos;t list the Sheet&apos;s tabs: {tabsError} You can upload the tab as a CSV file instead.
          </p>
        )}

        <details className="den-group" open={!canReadSheet}>
          <summary className="den-toggle">{canReadSheet ? "Or upload a CSV file" : "Upload a CSV file"}</summary>
          <p className="form-note">
            In Google Sheets, open the <strong>2026-2027</strong> tab, then choose File → Download → Comma-separated
            values (.csv). That saves just the tab you&apos;re on. Upload that file here.
          </p>
          <form action={previewAction} className="form-row" style={{ alignItems: "flex-end" }}>
            <input type="hidden" name="source" value="csv" />
            <div className="form-field">
              <label htmlFor="import-file">CSV file</label>
              <input id="import-file" type="file" name="file" accept=".csv,text/csv" required />
            </div>
            <div className="form-field" style={{ flexGrow: 0, minWidth: 0 }}>
              <button type="submit" className="btn btn-quiet" disabled={pending}>
                {pending ? "Reading the file…" : "Preview File"}
              </button>
            </div>
          </form>
        </details>
      </div>

      {state.preview && (
        <ImportPreview key={state.run} preview={state.preview} file={state.file} categories={categories} />
      )}
    </>
  );
}

function ImportPreview({
  preview,
  file,
  categories,
}: {
  preview: LedgerImportPreview;
  file: File | undefined;
  categories: ImportCategoryOption[];
}) {
  const { parse, source } = preview;
  const { totals } = parse;
  const blocked = parse.errors.length > 0 || parse.rows.length === 0;
  const sourceName = source.kind === "sheet" ? `the “${source.tab}” tab` : `“${source.fileName}”`;

  // The same file goes back with Confirm; the server reads and checks it again.
  const confirm = async (formData: FormData) => {
    if (source.kind === "csv") {
      if (!file) return { error: "Choose the CSV file and preview it again." };
      formData.set("file", file);
    }
    return confirmLedgerImportAction(formData);
  };

  return (
    <div className="info-card" style={{ marginBottom: 24 }}>
      <h3>Preview</h3>
      <p>
        {parse.rows.length === 1 ? "1 line" : `${parse.rows.length} lines`} read from {sourceName}
        {totals.firstDate && totals.lastDate && (
          <>
            , dated {formatDateOnly(totals.firstDate)} to {formatDateOnly(totals.lastDate)}
          </>
        )}
        . Money in {money(totals.inflowCents)}, money out {money(totals.outflowCents)}, leaving a bank balance of{" "}
        <strong>{money(totals.endingBalanceCents)}</strong>.
      </p>

      {parse.errors.length > 0 && (
        <div className="form-error" role="alert">
          <p style={{ margin: "0 0 6px", fontWeight: 700 }}>
            {parse.errors.length === 1 ? "1 problem needs" : `${parse.errors.length} problems need`} fixing in the Sheet
            before anything can be imported. Fix {parse.errors.length === 1 ? "it" : "them"}, then preview again.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {parse.errors.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      {parse.warnings.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ margin: "0 0 6px", fontWeight: 700 }}>Worth a look (these don&apos;t stop the import):</p>
          <ul className="form-note" style={{ margin: 0, paddingLeft: 20 }}>
            {parse.warnings.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      {preview.overlappingPortalLines > 0 && totals.lastDate && (
        <p className="form-error">
          The ledger already has {preview.overlappingPortalLines === 1 ? "1 line" : `${preview.overlappingPortalLines} lines`}{" "}
          typed into the portal dated on or before {formatDateOnly(totals.lastDate)}. If{" "}
          {preview.overlappingPortalLines === 1 ? "it's" : "they're"} in the Sheet too, the money would be counted twice
          — delete {preview.overlappingPortalLines === 1 ? "it" : "them"} from the Ledger page first.
        </p>
      )}

      {parse.summaryChecks.length > 0 && (
        <>
          <h4 style={{ margin: "16px 0 8px" }}>The Sheet&apos;s boxes vs. the rows</h4>
          <table className="data-table" style={{ marginBottom: 16 }}>
            <thead>
              <tr>
                <th>Box</th>
                <th>In the Sheet</th>
                <th>From the rows</th>
                <th>Check</th>
              </tr>
            </thead>
            <tbody>
              {parse.summaryChecks.map((check) => (
                <tr key={check.label}>
                  <td>{check.label}</td>
                  <td data-label="In the Sheet">{money(check.sheetCents)}</td>
                  <td data-label="From the rows">{check.computedCents === null ? "—" : money(check.computedCents)}</td>
                  <td data-label="Check">
                    {check.matches === null ? (
                      <span className="form-note">Not checked</span>
                    ) : check.matches ? (
                      <span className="badge-pill badge-paid">Matches</span>
                    ) : (
                      <span className="badge-pill badge-unpaid">Differs</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {parse.rows.length > 0 && (
        <CollapsibleGroup label={`All ${parse.rows.length} lines`} defaultOpen={false}>
          <table className="data-table" style={{ marginBottom: 16 }}>
            <thead>
              <tr>
                <th>Row</th>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th>Inflow</th>
                <th>Outflow</th>
              </tr>
            </thead>
            <tbody>
              {parse.rows.map((row) => (
                <tr key={row.sheetRow}>
                  <td>Row {row.sheetRow}</td>
                  <td data-label="Date">{formatDateOnly(row.date)}</td>
                  <td data-label="Description">{row.description}</td>
                  <td data-label="Category">{row.category}</td>
                  <td data-label="Inflow" className={row.direction === "IN" ? "balance-positive" : undefined}>
                    {row.direction === "IN" ? money(row.cents) : ""}
                  </td>
                  <td data-label="Outflow" className={row.direction === "OUT" ? "balance-negative" : undefined}>
                    {row.direction === "OUT" ? money(row.cents) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CollapsibleGroup>
      )}

      {blocked && (
        <p>
          <button type="button" className="btn btn-primary" disabled>
            Import
          </button>{" "}
          <span className="form-note">
            {parse.rows.length === 0 && parse.errors.length === 0 ? "There are no lines to import." : "Fix the problems above first."}
          </span>
        </p>
      )}

      {!blocked && (
        <TripAdminForm action={confirm}>
          <input type="hidden" name="source" value={source.kind} />
          {source.kind === "sheet" && <input type="hidden" name="tab" value={source.tab} />}
          <input type="hidden" name="fingerprint" value={parse.fingerprint} />

          <h4 style={{ margin: "16px 0 8px" }}>Where each Sheet category goes</h4>
          <p className="form-note" style={{ marginTop: 0 }}>
            Pick an existing category, or make a new one. An <strong>Event</strong> category holds money collected for
            one event or trip, and its balance is set aside from Available to Spend.
          </p>
          <table className="data-table" style={{ marginBottom: 16 }}>
            <thead>
              <tr>
                <th>Sheet category</th>
                <th>Lines</th>
                <th>Net</th>
                <th>Goes into</th>
                <th>Kind (if new)</th>
              </tr>
            </thead>
            <tbody>
              {preview.mappings.map((mapping, i) => (
                <tr key={mapping.key}>
                  <td>{mapping.name}</td>
                  <td data-label="Lines">{mapping.count}</td>
                  <td data-label="Net">{money(mapping.netCents)}</td>
                  <td data-label="Goes into">
                    <select
                      aria-label={`Where “${mapping.name}” goes`}
                      id={`import-target-${i}`}
                      name={`target:${mapping.key}`}
                      defaultValue={mapping.target}
                    >
                      <option value="new">New category “{mapping.name}”</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                          {category.archived ? " (archived)" : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td data-label="Kind (if new)">
                    <select aria-label={`Kind for “${mapping.name}”`} name={`kind:${mapping.key}`} defaultValue={mapping.kind}>
                      <option value="FUND">Fund</option>
                      <option value="EVENT">Event</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {parse.transferPairs.length > 0 && (
            <>
              <h4 style={{ margin: "16px 0 8px" }}>Moves between categories?</h4>
              <p className="form-note" style={{ marginTop: 0 }}>
                These lines look like money moved from one category to another (same date and amount, one out, one in) —
                an event&apos;s close-out, say. Tick the ones that are, and they&apos;re linked as one move: the bank
                balance is the same either way, but a move isn&apos;t counted as money in or out for the year.
              </p>
              {parse.transferPairs.map((pair) => (
                <label key={pair.id} className="cal-check">
                  <input type="checkbox" name="pair" value={pair.id} />
                  <span>
                    {money(pair.cents)} from {pair.fromCategory} to {pair.toCategory} on {formatDateOnly(pair.date)}
                    <small>
                      Rows {pair.outRow} and {pair.inRow}
                    </small>
                  </span>
                </label>
              ))}
            </>
          )}

          <div className="form-field" style={{ maxWidth: 320, marginTop: 16 }}>
            <label htmlFor="import-cutover">Cutover date</label>
            <input
              id="import-cutover"
              type="date"
              name="cutoverDate"
              defaultValue={preview.defaultCutover ?? undefined}
              min={preview.defaultCutover ?? undefined}
              max={preview.latestCutover}
              required
            />
            <span className="form-note" style={{ marginTop: 0 }}>
              The day the portal takes over from the Sheet. Lines dated before it come from the Sheet; from it on, enter
              them here. It has to be after the last imported line.
            </span>
          </div>

          <ConfirmImportButton count={parse.rows.length} />
        </TripAdminForm>
      )}
    </div>
  );
}

function ConfirmImportButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? "Importing…" : `Import ${count === 1 ? "1 Line" : `${count} Lines`}`}
    </button>
  );
}
