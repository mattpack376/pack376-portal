import Link from "next/link";
import { isAdvancementAuditEditor, isMasterAdminSession, requireAdvancementAuditSession } from "@/lib/authorize";
import {
  ADVANCEMENT_AUDIT_PAGE_SIZES,
  STATUS_FILTER_OPTIONS,
  advancementAuditQuery,
  getAdvancementAuditPage,
  getAdvancementHistory,
  parseAdvancementAuditFilters,
  type AdvancementAuditSearchParams,
} from "@/lib/advancementAuditData";
import {
  DISCREPANCY_HELP,
  DISCREPANCY_LABELS,
  MAX_AUDIT_NOTE_LENGTH,
  STATUS_LABELS,
  type AdvancementAuditStatus,
} from "@/lib/advancementAuditRules";
import { RANK_INFO, RANK_ORDER } from "@/lib/rankConfig";
import { formatDateOnly } from "@/lib/dateOnly";
import { advancementAuditAction } from "@/lib/actions/advancementAudit";
import SegmentedNav from "@/components/SegmentedNav";
import FileExportButton from "@/components/FileExportButton";
import SelectAllCheckbox from "@/components/SelectAllCheckbox";

/**
 * Audits -> Advancement: every adventure record of a season, checked for
 * dates that don't add up, with what's waiting to be handed out. Admin and
 * Junior Admin see every den and can flag or resolve records; a Den Leader
 * sees their own den(s) read-only, so they can find what an Admin sent back.
 *
 * Every filter is a search param and the form is a plain GET, like the Audit
 * Log. The rules are in src/lib/advancementAuditRules.ts.
 */

const BULK_FORM = "advancement-audit-bulk";

const STATUS_BADGE: Record<AdvancementAuditStatus, string> = {
  FLAGGED: "aa-status-flagged",
  NEEDS_CORRECTION: "aa-status-correction",
  RESOLVED: "aa-status-resolved",
  READY_FOR_AWARD: "aa-status-ready",
  AWARDED: "aa-status-awarded",
};

const ERRORS: Record<string, string> = {
  denied: "Only an Admin or Junior Admin can flag or resolve records.",
  intent: "Something went wrong — try that again.",
  none: "Tick at least one record first.",
  toomany: "That's too many at once — 200 records at most.",
  note: "Add a note: what needs fixing, or why it's fine as it is.",
};

function doneMessage(done: string, n: number, skipped: number) {
  const records = (count: number) => `${count} record${count === 1 ? "" : "s"}`;
  const main =
    done === "flag"
      ? `Flagged ${records(n)} for correction. The den leader will see the note here.`
      : done === "resolve"
        ? `Marked ${records(n)} resolved.`
        : `Cleared the mark on ${records(n)}.`;
  if (skipped === 0) return main;
  const why = done === "resolve" ? "nothing wrong with them" : done === "clear" ? "no mark to clear" : "not found";
  return `${main} Skipped ${records(skipped)} (${why}).`;
}

const when = (date: Date) =>
  date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default async function AdvancementAuditPage({
  searchParams,
}: {
  searchParams: Promise<AdvancementAuditSearchParams & { done?: string; n?: string; skipped?: string; error?: string }>;
}) {
  const session = await requireAdvancementAuditSession();
  const params = await searchParams;

  const filters = parseAdvancementAuditFilters(params);
  const canEdit = isAdvancementAuditEditor(session);
  const [isMaster, data] = await Promise.all([isMasterAdminSession(session), getAdvancementAuditPage(session, filters)]);
  const { records, metrics, dens, years, total, page, pageCount } = data;
  const history = await getAdvancementHistory(records);

  const href = (overrides: Parameters<typeof advancementAuditQuery>[1] = {}) =>
    `/portal/audits/advancement?${advancementAuditQuery(filters, overrides).toString()}`;
  const exportQuery = advancementAuditQuery(filters, { page: 1 });
  exportQuery.delete("page");
  exportQuery.delete("per");
  const backQuery = advancementAuditQuery(filters, { page }).toString();
  const hasFilters = !!(filters.denId || filters.rank || filters.status !== "all" || filters.from || filters.to || filters.q);
  const firstOnPage = total === 0 ? 0 : (page - 1) * filters.pageSize + 1;
  const lastOnPage = Math.min(page * filters.pageSize, total);
  const fixHref = (denId: string) => (canEdit ? `/portal/admin/dens/${denId}` : `/portal/den?denId=${denId}`);

  const n = Number(params.n) || 0;
  const skipped = Number(params.skipped) || 0;
  const flash =
    params.error && ERRORS[params.error]
      ? { kind: "error" as const, text: ERRORS[params.error] }
      : params.done && ["flag", "resolve", "clear"].includes(params.done)
        ? { kind: "success" as const, text: doneMessage(params.done, n, skipped) }
        : null;

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Audits</div>
        <h2>Advancement Audits</h2>
        <p>
          Every adventure checked off this season, tested for dates that don&apos;t add up, plus what&apos;s been
          earned but not handed out yet.{" "}
          {canEdit
            ? "Flag a record to send it back to its den leader with a note, or mark a flag resolved when the dates are right after all."
            : "Records an Admin has flagged for correction show their note here — fix the dates on your den page and the flag clears itself."}
        </p>
      </div>

      {/* The master admin is the only one who also has the Audit Log. */}
      {isMaster && (
        <SegmentedNav
          noPrint
          active="advancement"
          items={[
            { key: "advancement", href: "/portal/audits/advancement", label: "Advancement" },
            { key: "log", href: "/portal/admin/audit", label: "Audit Log" },
          ]}
        />
      )}

      {flash && <p className={flash.kind === "error" ? "form-error" : "form-success"}>{flash.text}</p>}

      <div className="aa-metrics" role="list" aria-label="Summary">
        <Link role="listitem" className="aa-metric" href={href({ status: "all", page: 1 })} scroll={false}>
          <span className="aa-metric-value">{metrics.audited}</span>
          <span className="aa-metric-label">Records audited</span>
        </Link>
        <Link role="listitem" className="aa-metric aa-metric-review" href={href({ status: "review", page: 1 })} scroll={false}>
          <span className="aa-metric-value">{metrics.needsReview}</span>
          <span className="aa-metric-label">Needs review</span>
          {metrics.needsCorrection > 0 && (
            <span className="aa-metric-sub">{metrics.needsCorrection} sent back to den leaders</span>
          )}
        </Link>
        <Link role="listitem" className="aa-metric aa-metric-flags" href={href({ status: "review", page: 1 })} scroll={false}>
          <span className="aa-metric-value">{metrics.discrepancies}</span>
          <span className="aa-metric-label">Discrepancies found</span>
          <span className="aa-metric-sub">including resolved ones</span>
        </Link>
        <Link role="listitem" className="aa-metric aa-metric-ready" href={href({ status: "ready", page: 1 })} scroll={false}>
          <span className="aa-metric-value">{metrics.readyForAward}</span>
          <span className="aa-metric-label">Ready for award</span>
          <span className="aa-metric-sub">
            {metrics.scoutsRankEarned} scout{metrics.scoutsRankEarned === 1 ? " has" : "s have"} earned their rank
          </span>
        </Link>
      </div>

      <form method="get" className="info-card no-print" style={{ marginBottom: 20, padding: 20 }}>
        {filters.pageSize !== 25 && <input type="hidden" name="per" value={filters.pageSize} />}
        <div className="form-row" style={{ marginBottom: 12, alignItems: "flex-end" }}>
          <div className="form-field">
            <label htmlFor="aa-year">Season</label>
            <select id="aa-year" name="year" defaultValue={filters.year}>
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
          {dens.length > 1 && (
            <div className="form-field">
              <label htmlFor="aa-den">Den</label>
              <select id="aa-den" name="denId" defaultValue={filters.denId ?? ""}>
                <option value="">Every den</option>
                {dens.map((den) => (
                  <option key={den.id} value={den.id}>
                    {den.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {canEdit && (
            <div className="form-field">
              <label htmlFor="aa-rank">Rank</label>
              <select id="aa-rank" name="rank" defaultValue={filters.rank ?? ""}>
                <option value="">Every rank</option>
                {RANK_ORDER.map((rank) => (
                  <option key={rank} value={rank}>
                    {RANK_INFO[rank].label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="form-field">
            <label htmlFor="aa-status">Status</label>
            <select id="aa-status" name="status" defaultValue={filters.status}>
              {STATUS_FILTER_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-row" style={{ marginBottom: 12, alignItems: "flex-end" }}>
          <div className="form-field">
            <label htmlFor="aa-from">Completed from</label>
            <input id="aa-from" name="from" type="date" defaultValue={filters.from ?? ""} />
          </div>
          <div className="form-field">
            <label htmlFor="aa-to">Completed to</label>
            <input id="aa-to" name="to" type="date" defaultValue={filters.to ?? ""} />
          </div>
          <div className="form-field">
            <label htmlFor="aa-q">Search</label>
            <input
              id="aa-q"
              name="q"
              type="search"
              enterKeyHint="search"
              placeholder="Scout or adventure"
              maxLength={80}
              defaultValue={filters.q ?? ""}
            />
          </div>
          <div className="form-field" style={{ flexGrow: 0 }}>
            <button className="btn btn-primary btn-small" type="submit">
              Apply
            </button>
          </div>
          {hasFilters && (
            <div className="form-field" style={{ flexGrow: 0 }}>
              <Link className="btn btn-quiet btn-small" href={`/portal/audits/advancement?year=${filters.year}`}>
                Clear
              </Link>
            </div>
          )}
        </div>
        <div className="segmented" style={{ marginBottom: 0, alignItems: "center", justifyContent: "space-between" }}>
          <p className="form-note" style={{ margin: 0 }}>
            {total === 0 ? "No records match." : `Showing ${firstOnPage}–${lastOnPage} of ${total}.`}
          </p>
          <div className="segmented" style={{ marginBottom: 0, alignItems: "center" }}>
            <FileExportButton
              className="btn btn-quiet btn-small"
              href={`/api/advancement-audit/export?${exportQuery.toString()}`}
              label="Export CSV"
            />
            <FileExportButton
              className="btn btn-quiet btn-small"
              href={`/api/advancement-audit/export/pdf?${exportQuery.toString()}`}
              label="Export PDF"
            />
            <span className="form-note" style={{ marginTop: 0 }}>
              Per page
            </span>
            {ADVANCEMENT_AUDIT_PAGE_SIZES.map((size) => (
              <Link
                key={size}
                href={href({ page: 1, pageSize: size })}
                scroll={false}
                aria-current={size === filters.pageSize ? "true" : undefined}
                className={`btn btn-small ${size === filters.pageSize ? "btn-primary" : "btn-quiet"}`}
              >
                {size}
              </Link>
            ))}
          </div>
        </div>
      </form>

      {canEdit && records.length > 0 && (
        <form id={BULK_FORM} action={advancementAuditAction} className="info-card no-print aa-bulk">
          <input type="hidden" name="back" value={backQuery} />
          <div className="form-field" style={{ marginBottom: 10 }}>
            <label htmlFor="aa-note">Note for the ticked records</label>
            <textarea
              id="aa-note"
              name="note"
              rows={2}
              maxLength={MAX_AUDIT_NOTE_LENGTH}
              placeholder="e.g. Award date is before the completion date — please check the year."
            />
          </div>
          <div className="segmented" style={{ marginBottom: 0 }}>
            <button className="btn btn-primary btn-small" type="submit" name="intent" value="flag">
              Flag for correction
            </button>
            <button className="btn btn-quiet btn-small" type="submit" name="intent" value="resolve">
              Mark resolved
            </button>
            <button className="btn btn-quiet btn-small" type="submit" name="intent" value="clear">
              Clear mark
            </button>
          </div>
          <p className="form-note" style={{ marginBottom: 0 }}>
            Tick records in the table, then choose. A note is needed to flag or resolve. Marks never change the
            advancement itself, and stop counting as soon as someone edits the record.
          </p>
        </form>
      )}

      <div className="table-scroll">
        <table className="data-table cards-md aa-table">
          <thead>
            <tr>
              <th>
                {canEdit && records.length > 0 && (
                  <span style={{ marginRight: 8 }}>
                    <SelectAllCheckbox form={BULK_FORM} name="recordId" label="Select every record on this page" />
                  </span>
                )}
                Scout
              </th>
              <th>Adventure</th>
              <th>Completed</th>
              <th>Awarded</th>
              <th>Entered by</th>
              <th>Status</th>
              <th>Discrepancy</th>
              <th className="no-print">Action</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 && (
              <tr>
                <td colSpan={8}>
                  {hasFilters
                    ? "No records match these filters."
                    : "No adventures have been checked off for this season yet."}
                </td>
              </tr>
            )}
            {records.map((record) => {
              const entries = history.get(record.recordId) ?? [];
              return (
                <tr key={record.recordId} className={`aa-row-${record.status.toLowerCase()}`}>
                  <td>
                    <label className="aa-scout">
                      {canEdit && (
                        <input
                          type="checkbox"
                          form={BULK_FORM}
                          name="recordId"
                          value={record.recordId}
                          aria-label={`Select ${record.adventureName} for ${record.scoutName}`}
                        />
                      )}
                      <span>
                        <span style={{ fontWeight: 700 }}>{record.scoutName}</span>
                        <span className="form-note" style={{ display: "block", marginTop: 0, fontWeight: 400 }}>
                          {record.denName}
                        </span>
                      </span>
                    </label>
                  </td>
                  <td data-label="Adventure">
                    <div>
                      {record.adventureName}
                      <span className="form-note" style={{ display: "block", marginTop: 0 }}>
                        {RANK_INFO[record.rank].label} · {record.adventureType === "REQUIRED" ? "Required" : "Elective"}
                      </span>
                    </div>
                  </td>
                  <td data-label="Completed" style={{ whiteSpace: "nowrap" }}>
                    {record.completedDate ? formatDateOnly(record.completedDate) : "—"}
                  </td>
                  <td data-label="Awarded" style={{ whiteSpace: "nowrap" }}>
                    {record.awardedDate ? formatDateOnly(record.awardedDate) : "—"}
                  </td>
                  <td data-label="Entered by">{record.enteredBy ?? "—"}</td>
                  <td data-label="Status" className="cell-block">
                    <span className={`badge-pill ${STATUS_BADGE[record.status]}`}>{STATUS_LABELS[record.status]}</span>
                    {record.mark && (
                      <span className="form-note aa-mark-note">
                        “{record.mark.note}” — {record.mark.by ?? "deleted account"}, {when(record.mark.at)}
                      </span>
                    )}
                  </td>
                  <td data-label="Discrepancy" className="cell-block">
                    {record.discrepancies.length === 0
                      ? "—"
                      : record.discrepancies.map((type) => (
                          <span key={type} className="aa-tag" title={DISCREPANCY_HELP[type]}>
                            {DISCREPANCY_LABELS[type]}
                          </span>
                        ))}
                  </td>
                  <td className="actions no-print">
                    <Link className="btn btn-quiet btn-small" href={fixHref(record.denId)}>
                      Open den
                    </Link>
                    <details className="aa-history">
                      <summary className="btn btn-quiet btn-small">History</summary>
                      <div className="aa-history-body">
                        <p className="form-note" style={{ marginTop: 0 }}>
                          Last saved {when(record.updatedAt)}
                          {record.enteredBy ? ` by ${record.enteredBy}` : ""}.
                        </p>
                        {record.discrepancies.map((type) => (
                          <p key={type} className="form-note" style={{ marginTop: 0 }}>
                            <strong>{DISCREPANCY_LABELS[type]}:</strong> {DISCREPANCY_HELP[type]}
                          </p>
                        ))}
                        {entries.length === 0 ? (
                          <p className="form-note" style={{ marginBottom: 0 }}>
                            No changes in the log (it keeps the last 12 months).
                          </p>
                        ) : (
                          <ul className="aa-history-list">
                            {entries.map((entry, i) => (
                              <li key={i}>
                                <span className="form-note" style={{ marginTop: 0 }}>
                                  {when(entry.at)} · {entry.who}
                                </span>
                                <span>{entry.text}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="segmented no-print" style={{ marginTop: 20, alignItems: "center" }}>
          {page > 1 ? (
            <Link className="btn btn-quiet btn-small" href={href({ page: page - 1 })}>
              ← Previous
            </Link>
          ) : (
            <span className="btn btn-quiet btn-small" aria-disabled="true" style={{ opacity: 0.45 }}>
              ← Previous
            </span>
          )}
          <span className="form-note" style={{ marginTop: 0, alignSelf: "center" }}>
            Page {page} of {pageCount}
          </span>
          {page < pageCount ? (
            <Link className="btn btn-quiet btn-small" href={href({ page: page + 1 })}>
              Next →
            </Link>
          ) : (
            <span className="btn btn-quiet btn-small" aria-disabled="true" style={{ opacity: 0.45 }}>
              Next →
            </span>
          )}
        </div>
      )}
    </>
  );
}
