import Link from "next/link";
import { requireMasterAdminSession } from "@/lib/authorize";
import { ROLE_LABELS, ROLE_BADGE_CLASSES } from "@/lib/roleLabels";
import {
  AUDIT_VIEWS,
  AUDIT_PAGE_SIZE,
  auditCategoryLabel,
  getAuditLogPage,
  isAuditView,
  parseAuditDetails,
  type AuditView,
} from "@/lib/auditLogData";
import SegmentedNav from "@/components/SegmentedNav";

/**
 * The full history of changes made through the portal — one tab for admin
 * accounts, one for den leaders, and an "Everyone" catch-all.
 *
 * Master admins only (requireMasterAdminSession), matching the Danger Zone
 * reset page: a log that the people it records can edit their own way out of
 * isn't worth much, and regular admins are themselves subjects of it.
 * Deliberately read-only — there is no UI anywhere that edits or deletes an
 * AuditLog row.
 */
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; actor?: string; category?: string; denId?: string; page?: string }>;
}) {
  await requireMasterAdminSession();
  const params = await searchParams;

  const view: AuditView = isAuditView(params.view) ? params.view : "admins";
  const pageParam = Number(params.page);
  const requestedPage = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;

  const { entries, total, page, pageCount, actors, categories, dens } = await getAuditLogPage({
    view,
    actorUserId: params.actor || undefined,
    category: params.category || undefined,
    denId: params.denId || undefined,
    page: requestedPage,
  });

  // Filters are scoped to the tab, so carrying them across tabs would usually
  // land on an empty table (a den leader has no "Logins & Roles" entries).
  const tabs = (Object.keys(AUDIT_VIEWS) as AuditView[]).map((key) => ({
    key,
    href: `/portal/admin/audit?view=${key}`,
    label: AUDIT_VIEWS[key].label,
  }));

  const pageHref = (targetPage: number) => {
    const query = new URLSearchParams({ view });
    if (params.actor) query.set("actor", params.actor);
    if (params.category) query.set("category", params.category);
    if (params.denId) query.set("denId", params.denId);
    if (targetPage > 1) query.set("page", String(targetPage));
    return `/portal/admin/audit?${query.toString()}`;
  };

  const firstOnPage = total === 0 ? 0 : (page - 1) * AUDIT_PAGE_SIZE + 1;
  const lastOnPage = Math.min(page * AUDIT_PAGE_SIZE, total);
  const hasFilters = !!(params.actor || params.category || params.denId);

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Admin</div>
        <h2>Audit Log</h2>
        <p>
          Every change made through the portal, newest first — who made it, what it was, and the values before and
          after. Entries are never edited or deleted, and only the master admin accounts can read this page.
        </p>
      </div>

      <SegmentedNav items={tabs} active={view} noPrint />

      <p className="form-note" style={{ marginTop: -12, marginBottom: 20 }}>
        {view === "admins" && "Changes made by Admin and Junior Admin accounts."}
        {view === "dens" && "Changes made by Den Leader logins — mostly attendance and advancement for their own den."}
        {view === "all" &&
          "Every account, including Attendance Only, Photographer, Trip Viewer and parent logins. Entries whose account has since been deleted appear here too."}
      </p>

      {/*
        A plain GET form: the page is a Server Component and every filter is a
        search param, so this needs no client JavaScript. Resetting to page 1
        on a new filter happens for free, since `page` isn't a field here.
      */}
      <form method="get" className="info-card no-print" style={{ marginBottom: 24, padding: 20 }}>
        <input type="hidden" name="view" value={view} />
        <div className="form-row" style={{ marginBottom: 12, alignItems: "flex-end" }}>
          <div className="form-field">
            <label htmlFor="audit-actor">Who</label>
            <select id="audit-actor" name="actor" defaultValue={params.actor ?? ""}>
              <option value="">Anyone</option>
              {actors.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.displayName} ({actor.username}) — {actor.count}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="audit-category">What</label>
            <select id="audit-category" name="category" defaultValue={params.category ?? ""}>
              <option value="">Anything</option>
              {categories.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label} — {category.count}
                </option>
              ))}
            </select>
          </div>
          {dens.length > 0 && (
            <div className="form-field">
              <label htmlFor="audit-den">Den</label>
              <select id="audit-den" name="denId" defaultValue={params.denId ?? ""}>
                <option value="">Any den</option>
                {dens.map((den) => (
                  <option key={den.id} value={den.id}>
                    {den.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="form-field" style={{ flexGrow: 0 }}>
            <button className="btn btn-primary btn-small" type="submit">
              Apply
            </button>
          </div>
          {hasFilters && (
            <div className="form-field" style={{ flexGrow: 0 }}>
              <Link className="btn btn-quiet btn-small" href={`/portal/admin/audit?view=${view}`}>
                Clear
              </Link>
            </div>
          )}
        </div>
        <p className="form-note" style={{ marginTop: 0 }}>
          {total === 0
            ? "No entries match."
            : `Showing ${firstOnPage}–${lastOnPage} of ${total} ${total === 1 ? "entry" : "entries"}.`}
        </p>
      </form>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What changed</th>
              <th style={{ whiteSpace: "nowrap" }}>Area</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={4}>
                  {hasFilters
                    ? "No entries match these filters."
                    : "Nothing recorded yet. Entries appear here as soon as someone changes something in the portal."}
                </td>
              </tr>
            )}
            {entries.map((entry) => {
              const details = parseAuditDetails(entry.details);
              return (
                <tr key={entry.id}>
                  {/*
                    Date and time on separate lines rather than one nowrap
                    string: on a phone the single line was wide enough to push
                    "What changed" — the column you actually came for — off the
                    side of the scroll container.
                  */}
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>
                    <div>
                      {entry.createdAt.toLocaleDateString("en-US", {
                        timeZone: "America/New_York",
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </div>
                    <div className="form-note" style={{ marginTop: 0 }}>
                      {entry.createdAt.toLocaleTimeString("en-US", {
                        timeZone: "America/New_York",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                      <span style={{ fontWeight: 700 }}>{entry.actorDisplayName}</span>
                      <span className="form-note" style={{ marginTop: 0 }}>
                        {entry.actorUsername}
                      </span>
                      <span className={`badge-pill ${ROLE_BADGE_CLASSES[entry.actorRole] ?? "badge-pending"}`}>
                        {ROLE_LABELS[entry.actorRole] ?? entry.actorRole}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div>{entry.summary}</div>
                    {details.length > 0 && (
                      <ul
                        className="form-note"
                        style={{ marginTop: 6, marginBottom: 0, paddingLeft: 16, listStyle: "disc" }}
                      >
                        {details.map((detail, index) => (
                          <li key={`${detail.label}-${index}`} style={{ marginBottom: 2 }}>
                            <strong style={{ fontWeight: 700 }}>{detail.label}:</strong>{" "}
                            <span title={detail.from}>{truncate(detail.from)}</span> → <span title={detail.to}>{truncate(detail.to)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{auditCategoryLabel(entry.category)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="segmented no-print" style={{ marginTop: 20, alignItems: "center" }}>
          {page > 1 ? (
            <Link className="btn btn-quiet btn-small" href={pageHref(page - 1)}>
              ← Newer
            </Link>
          ) : (
            <span className="btn btn-quiet btn-small" aria-disabled="true" style={{ opacity: 0.45 }}>
              ← Newer
            </span>
          )}
          <span className="form-note" style={{ marginTop: 0, alignSelf: "center" }}>
            Page {page} of {pageCount}
          </span>
          {page < pageCount ? (
            <Link className="btn btn-quiet btn-small" href={pageHref(page + 1)}>
              Older →
            </Link>
          ) : (
            <span className="btn btn-quiet btn-small" aria-disabled="true" style={{ opacity: 0.45 }}>
              Older →
            </span>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Details hold whole descriptions and pasted HTML, which would otherwise
 * stretch a row well past the table. The untruncated value stays available as
 * the cell's title attribute.
 */
function truncate(value: string, max = 120) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
