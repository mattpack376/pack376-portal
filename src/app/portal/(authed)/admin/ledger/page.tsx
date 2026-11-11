import Link from "next/link";
import { requireLedgerSession } from "@/lib/authorize";
import { getLedger } from "@/lib/ledgerData";
import { getLedgerSyncView } from "@/lib/ledgerSync";
import { parseLedgerScoutingYear, scoutingYearOf } from "@/lib/ledgerMath";
import { formatDateOnly, PACK_TIME_ZONE, todayDateOnly, todayDateOnlyString, toDateOnlyString } from "@/lib/dateOnly";
import { formatCents } from "@/lib/duesData";
import { addLedgerEntryAction, addLedgerTransferAction, restoreLedgerEntryAction } from "@/lib/actions/ledger";
import LedgerSubNav from "@/components/LedgerSubNav";
import LedgerSummaryCards from "@/components/LedgerSummaryCards";
import LedgerEntryFields from "@/components/LedgerEntryFields";
import LedgerTable from "@/components/LedgerTable";
import LedgerSyncStatus from "@/components/LedgerSyncStatus";
import TripAdminForm from "@/components/TripAdminForm";
import SubmitButton from "@/components/SubmitButton";
import CollapsibleGroup from "@/components/CollapsibleGroup";
import SegmentedNav from "@/components/SegmentedNav";
import FileExportButton from "@/components/FileExportButton";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";

// Server Actions on this page take their time limit from here (the Sheet sync runs after a save).
export const maxDuration = 60;

const ALL_YEARS = "all";

/**
 * The pack's bank ledger: what came in and went out, by category, with the
 * running bank balance — what the treasurer's Google Sheet used to be. Only
 * the ledger accounts (LEDGER_USERNAMES) can open it; every other Admin is
 * sent to the dashboard by requireLedgerSession.
 */
export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; category?: string; q?: string }>;
}) {
  await requireLedgerSession();
  const params = await searchParams;

  const currentYear = scoutingYearOf(todayDateOnly());
  const year = params.year === ALL_YEARS ? null : (parseLedgerScoutingYear(params.year) ?? currentYear);
  const [ledger, syncView] = await Promise.all([
    getLedger({ year, categoryId: params.category || null, q: params.q || null }),
    // Finding the Sheet behind (a sync failed or was cut short) asks for another.
    getLedgerSyncView({ nudge: true }),
  ]);
  const { filters } = ledger;

  /** This page with the filters, at another year. */
  const yearHref = (target: string) => {
    const query = new URLSearchParams();
    if (target !== currentYear) query.set("year", target);
    if (filters.categoryId) query.set("category", filters.categoryId);
    if (filters.q) query.set("q", params.q ?? "");
    const search = query.toString();
    return search ? `/portal/admin/ledger?${search}` : "/portal/admin/ledger";
  };
  const yearItems = [
    ...ledger.years.map((y) => ({ key: y, href: yearHref(y), label: y })),
    { key: ALL_YEARS, href: yearHref(ALL_YEARS), label: "All years" },
  ];
  const activeYear = year ?? ALL_YEARS;
  const hasFilters = !!(filters.categoryId || filters.q);
  const exportHref = `/portal/admin/ledger/export?year=${encodeURIComponent(activeYear)}`;
  // The first fund in display order (General Fund unless the treasurer renamed or reordered it).
  const generalFund = ledger.activeCategories.find((c) => c.kind === "FUND") ?? ledger.activeCategories[0];
  const categoryOptions = ledger.activeCategories.map(({ id, name, archived }) => ({ id, name, archived }));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Money</div>
          <h2>Ledger</h2>
          <p>
            The pack&apos;s bank account, line by line: what came in, what went out, and the balance after each. Only
            the accounts set up for the Ledger can see this page.
          </p>
        </div>
        <FileExportButton className="btn btn-quiet" href={exportHref} label="Export CSV" />
      </div>

      <LedgerSubNav active="ledger" />

      <LedgerSyncStatus view={syncView} />

      <LedgerSummaryCards summary={ledger.summary} periodLabel={year} />

      <div className="info-card" style={{ marginBottom: 24 }}>
        <h3>Add to the Ledger</h3>
        <TripAdminForm action={addLedgerEntryAction}>
          <div className="form-row" style={{ alignItems: "flex-end" }}>
            <LedgerEntryFields idPrefix="add-" categories={categoryOptions} defaultCategoryId={generalFund?.id} />
          </div>
          <SubmitButton className="btn btn-primary" pendingLabel="Adding…">
            Add Line
          </SubmitButton>
        </TripAdminForm>
      </div>

      <div style={{ marginBottom: 24 }}>
        <CollapsibleGroup defaultOpen={false} label="Move money between categories">
          <div className="info-card" style={{ marginTop: 8 }}>
            <p className="form-note" style={{ marginTop: 0 }}>
              For closing out an event or moving money from one fund to another. It adds two lines — out of one
              category, into the other — so the bank balance doesn&apos;t change.
            </p>
            <TripAdminForm action={addLedgerTransferAction}>
              <div className="form-row" style={{ alignItems: "flex-end" }}>
                <div className="form-field">
                  <label htmlFor="move-entryDate">Date</label>
                  <input
                    id="move-entryDate"
                    name="entryDate"
                    type="date"
                    required
                    max={todayDateOnlyString()}
                    defaultValue={todayDateOnlyString()}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="move-from">From</label>
                  <select key={`from-${categoryOptions.map((c) => c.id).join(",")}`} id="move-from" name="fromCategoryId" required>
                    {categoryOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor="move-to">To</label>
                  <select
                    key={`to-${categoryOptions.map((c) => c.id).join(",")}`}
                    id="move-to"
                    name="toCategoryId"
                    required
                    defaultValue={generalFund?.id}
                  >
                    {categoryOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor="move-amount">Amount ($)</label>
                  <input id="move-amount" name="amount" type="number" inputMode="decimal" min="0.01" max="1000000" step="0.01" required />
                </div>
              </div>
              <div className="form-row" style={{ alignItems: "flex-end" }}>
                <div className="form-field">
                  <label htmlFor="move-description">Description (optional)</label>
                  <input id="move-description" name="description" maxLength={200} placeholder="Move from … to …" />
                </div>
                <div className="form-field">
                  <label htmlFor="move-note">Note (optional)</label>
                  <input id="move-note" name="note" maxLength={2000} />
                </div>
              </div>
              <SubmitButton className="btn btn-primary" pendingLabel="Moving…">
                Move Money
              </SubmitButton>
            </TripAdminForm>
          </div>
        </CollapsibleGroup>
      </div>

      <SegmentedNav items={yearItems} active={activeYear} noPrint />

      {/* A plain GET form, like the audit log's filters: every filter is a search param. */}
      <form method="get" className="info-card no-print" style={{ marginBottom: 24, padding: 20 }}>
        {year !== currentYear && <input type="hidden" name="year" value={activeYear} />}
        <div className="form-row" style={{ marginBottom: 0, alignItems: "flex-end" }}>
          <div className="form-field">
            <label htmlFor="ledger-category">Category</label>
            <select key={`filter-${filters.categoryId ?? ""}`} id="ledger-category" name="category" defaultValue={filters.categoryId ?? ""}>
              <option value="">Every category</option>
              {ledger.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.archived ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="ledger-q">Search</label>
            <input id="ledger-q" name="q" type="search" maxLength={100} defaultValue={params.q ?? ""} placeholder="Description or note" />
          </div>
          <div className="form-field" style={{ flexGrow: 0, minWidth: 0 }}>
            <button className="btn btn-primary btn-small" type="submit">
              Apply
            </button>
          </div>
          {hasFilters && (
            <div className="form-field" style={{ flexGrow: 0, minWidth: 0 }}>
              <Link className="btn btn-quiet btn-small" href={yearHref(activeYear)}>
                Clear
              </Link>
            </div>
          )}
        </div>
      </form>

      <p className="form-note" style={{ marginTop: -12, marginBottom: 12 }}>
        {ledger.rows.length === 1 ? "1 line" : `${ledger.rows.length} lines`}
        {year ? ` in ${year} (September through August)` : ""}, newest first. The balance on each line is the bank
        balance after it, counting every line in every year.
      </p>

      <div style={{ marginBottom: 24 }}>
        <LedgerTable rows={ledger.rows} categories={categoryOptions} />
      </div>

      <CollapsibleGroup
        defaultOpen={false}
        label={`Deleted entries (${ledger.deletedEntries.length}${ledger.deletedEntries.length === 200 ? "+" : ""})`}
      >
        <div className="info-card" style={{ marginTop: 8 }}>
          {ledger.deletedEntries.length === 0 ? (
            <p style={{ marginBottom: 0 }}>Nothing has been deleted.</p>
          ) : (
            <>
              <p className="form-note" style={{ marginTop: 0 }}>
                Deleted lines don&apos;t count toward any balance. Restoring one puts it back where it was; restoring
                either half of a move between categories restores both.
              </p>
              <table className="data-table" style={{ marginBottom: 0 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th>Amount</th>
                    <th>Deleted</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.deletedEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{formatDateOnly(toDateOnlyString(entry.entryDate))}</td>
                      <td data-label="Description">{entry.description}</td>
                      <td data-label="Category">{entry.categoryName}</td>
                      <td data-label="Amount">
                        {formatCents(entry.amountCents)} {entry.direction === "IN" ? "in" : "out"}
                      </td>
                      <td data-label="Deleted">
                        {entry.deletedAt
                          ? entry.deletedAt.toLocaleDateString("en-US", { timeZone: PACK_TIME_ZONE, dateStyle: "medium" })
                          : ""}
                        {entry.deletedByName ? ` by ${entry.deletedByName}` : ""}
                      </td>
                      <td className="actions">
                        <form action={restoreLedgerEntryAction}>
                          <input type="hidden" name="id" value={entry.id} />
                          <ConfirmSubmitButton
                            className="btn btn-quiet btn-small"
                            pendingLabel="Restoring…"
                            message={`Restore “${entry.description}” (${formatCents(entry.amountCents)})? It goes back into the ledger and its balances.`}
                          >
                            Restore
                          </ConfirmSubmitButton>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </CollapsibleGroup>
    </>
  );
}
