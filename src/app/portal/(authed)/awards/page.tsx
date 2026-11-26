import Link from "next/link";
import { requirePendingAwardsSession } from "@/lib/authorize";
import { loadPendingAwards } from "@/lib/pendingAwardsData";
import { parsePendingAwardFilters, pendingAwardQuery, type PendingAwardSearchParams } from "@/lib/pendingAwardsRules";
import PendingAwardsView from "@/components/PendingAwardsView";

/**
 * Pending Awards: every adventure this season's scouts have finished but not
 * been handed yet, by scout or by award, with a bulk "Mark as Awarded" for
 * after a pack meeting and a Scout Shop list (CSV/PDF) of how many of each.
 *
 * Admin, Junior Admin and Committee Member see every den; a Den Leader their
 * own. Filters are search params on a plain GET form, like the audit page;
 * picking and awarding happen in PendingAwardsView.
 */
export default async function PendingAwardsPage({ searchParams }: { searchParams: Promise<PendingAwardSearchParams> }) {
  const session = await requirePendingAwardsSession();
  const filters = parsePendingAwardFilters(await searchParams);
  const data = await loadPendingAwards(session, filters);

  const allDens = session.role !== "DEN";
  const canSeeAudit = session.role === "ADMIN" || session.role === "JUNIOR_ADMIN" || session.role === "DEN";
  const denHref = (denId: string) => (allDens ? `/portal/admin/dens/${denId}` : `/portal/den?denId=${denId}`);
  const hasFilters = !!(filters.denId || filters.adventure || filters.before);

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Advancement</div>
        <h2>Pending Awards</h2>
        <p>
          Adventures scouts have finished but haven&apos;t been handed yet, {data.year}. After a pack meeting, tick what
          was given out and mark it awarded in one go. <strong>By award</strong> is the shopping list for the Scout Shop.
        </p>
      </div>

      <form method="get" className="info-card no-print" style={{ marginBottom: 20, padding: 20 }}>
        <div className="form-row" style={{ marginBottom: 0, alignItems: "flex-end" }}>
          {data.dens.length > 1 && (
            <div className="form-field">
              <label htmlFor="pa-den">Den</label>
              <select id="pa-den" name="denId" defaultValue={filters.denId ?? ""}>
                <option value="">All dens</option>
                {data.dens.map((den) => (
                  <option key={den.id} value={den.id}>
                    {den.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="form-field">
            <label htmlFor="pa-adventure">Adventure</label>
            <select id="pa-adventure" name="adventure" defaultValue={filters.adventure ?? ""}>
              <option value="">Every adventure</option>
              {/* Keeps a chosen name that has since run out, so the filter still reads what it is. */}
              {[...new Set([...(filters.adventure ? [filters.adventure] : []), ...data.adventureNames])]
                .sort((a, b) => a.localeCompare(b))
                .map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="pa-before">Completed on or before</label>
            <input id="pa-before" name="before" type="date" defaultValue={filters.before ?? ""} />
          </div>
          <div className="form-field" style={{ flexGrow: 0 }}>
            <button className="btn btn-primary btn-small" type="submit">
              Apply
            </button>
          </div>
          {hasFilters && (
            <div className="form-field" style={{ flexGrow: 0 }}>
              <Link className="btn btn-quiet btn-small" href="/portal/awards">
                Clear
              </Link>
            </div>
          )}
        </div>
      </form>

      <PendingAwardsView
        // A new filter is a new list: start its selection afresh.
        key={pendingAwardQuery(filters).toString()}
        items={data.items}
        heldBack={data.heldBack}
        hasFilters={hasFilters}
        readyForAwardTotal={data.readyForAwardTotal}
        exportQuery={pendingAwardQuery(filters).toString()}
        auditHref={canSeeAudit ? `/portal/audits/advancement?year=${data.year}&status=review` : null}
        denLinks={Object.fromEntries(data.dens.map((d) => [d.id, denHref(d.id)]))}
      />
    </>
  );
}
