"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { awardPendingAction, undoAwardBatchAction, type AwardSkip } from "@/lib/actions/advancement";
import { DISCREPANCY_LABELS, awardTypeLabel } from "@/lib/advancementAuditRules";
import { formatDateOnly, todayDateOnlyString } from "@/lib/dateOnly";
import { RANK_INFO } from "@/lib/rankConfig";
import {
  MAX_AWARD_BATCH,
  awardDateProblem,
  completedAfter,
  groupByAward,
  groupByScout,
  type AwardUndoToken,
  type PendingAwardItem,
} from "@/lib/pendingAwardsRules";
import FileExportButton from "@/components/FileExportButton";

const LEAVE_PROMPT = "You've ticked awards but haven't marked them awarded. Leave this page anyway?";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * While anything is ticked and not yet saved, asks before the page is left —
 * the same two prompts SaveButton uses: the browser's own for a reload or a
 * closed tab, and a confirm for an in-app link (which beforeunload never sees).
 */
function useLeaveGuard(active: boolean) {
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!activeRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const onClick = (event: MouseEvent) => {
      if (!activeRef.current || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download") || link.hasAttribute("data-file-download")) return;
      const to = new URL(link.href, window.location.href);
      if (to.origin === window.location.origin && to.pathname === window.location.pathname && to.search === window.location.search) return;
      if (window.confirm(LEAVE_PROMPT)) activeRef.current = false;
      else event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, []);
}

/** A select-all box for a group: ticked when all are, half-ticked when some are. */
function GroupCheckbox({
  keys,
  selected,
  onChange,
  label,
  disabled,
}: {
  keys: string[];
  selected: Set<string>;
  onChange: (keys: string[], on: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const count = keys.filter((k) => selected.has(k)).length;
  const all = count === keys.length && keys.length > 0;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && !all;
  }, [count, all]);
  return (
    <label className="pa-group-check">
      <input
        ref={ref}
        type="checkbox"
        checked={all}
        disabled={disabled || keys.length === 0}
        onChange={(e) => onChange(keys, e.currentTarget.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

type Notice =
  | { kind: "success"; text: string; skipped: AwardSkip[]; undo: AwardUndoToken | null }
  | { kind: "error"; text: string };

export default function PendingAwardsView({
  items,
  heldBack,
  hasFilters,
  readyForAwardTotal,
  exportQuery,
  ranksExportQuery,
  auditHref,
  denLinks,
}: {
  items: PendingAwardItem[];
  heldBack: PendingAwardItem[];
  hasFilters: boolean;
  /** This season's "Ready for award" count, unfiltered — the audit page shows the same number. */
  readyForAwardTotal: number;
  exportQuery: string;
  /** For the "Ranks awarded" CSV (badges already handed out this season). */
  ranksExportQuery: string;
  /** The audit page (its review filter), or null for a role that can't open it. */
  auditHref: string | null;
  /** Each den's advancement page, for "Open den". */
  denLinks: Record<string, string>;
}) {
  const router = useRouter();
  const today = todayDateOnlyString();
  const [view, setView] = useState<"scout" | "award">("scout");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [awardedDate, setAwardedDate] = useState(today);
  /** Awarded on this page since it loaded — hidden at once, before the refreshed list arrives. */
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isPending, startTransition] = useTransition();

  const visible = useMemo(() => items.filter((i) => !hidden.has(i.key)), [items, hidden]);
  const byScout = useMemo(() => groupByScout(visible), [visible]);
  const byAward = useMemo(() => groupByAward(visible), [visible]);
  const chosen = visible.filter((i) => selected.has(i.key));
  const dateProblem = awardDateProblem(awardedDate, today);
  const willSkip = dateProblem ? [] : completedAfter(chosen, awardedDate);
  const willAward = chosen.length - willSkip.length;
  const scoutCount = new Set(chosen.filter((i) => !willSkip.includes(i)).map((i) => i.scoutId)).size;

  useLeaveGuard(chosen.length > 0 && !isPending);

  function setKeys(keys: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  function handleAward() {
    if (isPending || chosen.length === 0) return;
    if (dateProblem) {
      setNotice({ kind: "error", text: dateProblem });
      return;
    }
    if (chosen.length > MAX_AWARD_BATCH) {
      setNotice({ kind: "error", text: `That's too many at once — ${MAX_AWARD_BATCH} awards at most. Award them a den at a time.` });
      return;
    }
    if (willAward === 0) {
      setNotice({ kind: "error", text: "Every ticked award was completed after that date — pick a later award date." });
      return;
    }
    const message =
      `Mark ${plural(willAward, "award")} for ${plural(scoutCount, "scout")} as awarded on ${formatDateOnly(awardedDate)}?` +
      (willSkip.length > 0 ? `\n\n${plural(willSkip.length, "ticked award was", "ticked awards were")} completed after that date and will be skipped.` : "");
    if (!window.confirm(message)) return;

    const sent = chosen;
    startTransition(async () => {
      try {
        const result = await awardPendingAction(
          sent.map((i) => ({ scoutId: i.scoutId, adventureId: i.adventureId })),
          awardedDate,
        );
        if (!result.ok) {
          setNotice({ kind: "error", text: result.error });
          return;
        }
        const awardedKeys = new Set(result.undo?.items.map((i) => `${i.scoutId}:${i.adventureId}`) ?? []);
        const goneKeys = new Set([
          ...awardedKeys,
          // Already awarded (or unchecked) by someone else: off the list too.
          ...result.skipped.filter((s) => s.reason === "not_pending").map((s) => `${s.scoutId}:${s.adventureId}`),
        ]);
        setHidden((prev) => new Set([...prev, ...goneKeys]));
        setSelected((prev) => new Set([...prev].filter((k) => !goneKeys.has(k))));
        setNotice({
          kind: "success",
          text: `Marked ${plural(result.awarded, "award")} for ${plural(result.scouts, "scout")} as awarded on ${formatDateOnly(result.awardedDate)}.`,
          skipped: result.skipped,
          undo: result.undo,
        });
        router.refresh();
      } catch {
        setNotice({ kind: "error", text: "Save failed — check your connection and try again. Nothing was marked." });
      }
    });
  }

  function handleUndo(token: AwardUndoToken) {
    if (isPending) return;
    startTransition(async () => {
      try {
        const result = await undoAwardBatchAction(token);
        if (!result.ok) {
          setNotice({ kind: "error", text: result.error });
          return;
        }
        const cleared = new Set(result.clearedKeys);
        setHidden((prev) => new Set([...prev].filter((k) => !cleared.has(k))));
        setNotice({
          kind: "success",
          text:
            `Undone — ${plural(result.cleared, "award")} back on the pending list.` +
            (result.changedSince > 0
              ? ` ${plural(result.changedSince, "was", "were")} edited on a scout's card since, so ${result.changedSince === 1 ? "it was" : "they were"} left as ${result.changedSince === 1 ? "it is" : "they are"}.`
              : ""),
          skipped: [],
          undo: null,
        });
        router.refresh();
      } catch {
        setNotice({ kind: "error", text: "Undo failed — check your connection and try again." });
      }
    });
  }

  const itemCheckbox = (item: PendingAwardItem, label: string) => (
    <input
      type="checkbox"
      checked={selected.has(item.key)}
      disabled={isPending}
      onChange={(e) => setKeys([item.key], e.currentTarget.checked)}
      aria-label={label}
    />
  );

  const resolvedTag = (item: PendingAwardItem) =>
    item.auditStatus === "RESOLVED" ? (
      <span className="aa-tag" title="Flagged on the advancement audit, then accepted as it is by an Admin.">
        Resolved on audit
      </span>
    ) : null;

  return (
    <>
      <div className="aa-metrics pa-metrics" role="list" aria-label="Summary">
        <div role="listitem" className="aa-metric aa-metric-ready">
          <span className="aa-metric-value">{visible.length}</span>
          <span className="aa-metric-label">{hasFilters ? "Pending (filtered)" : "Pending awards"}</span>
          <span className="aa-metric-sub">
            {readyForAwardTotal} ready for award this season{auditHref ? ", as on the audit page" : ""}
          </span>
        </div>
        <div role="listitem" className="aa-metric">
          <span className="aa-metric-value">{byScout.reduce((n, d) => n + d.scouts.length, 0)}</span>
          <span className="aa-metric-label">Scouts waiting</span>
        </div>
        {heldBack.length > 0 && (
          <div role="listitem" className="aa-metric aa-metric-review">
            <span className="aa-metric-value">{heldBack.length}</span>
            <span className="aa-metric-label">Held back</span>
            <span className="aa-metric-sub">flagged on the audit page</span>
          </div>
        )}
      </div>

      {notice && (
        <div className={`${notice.kind === "error" ? "form-error" : "form-success"} pa-notice`} role={notice.kind === "error" ? "alert" : "status"}>
          <span>{notice.text}</span>
          {notice.kind === "success" && notice.undo && (
            <button type="button" className="btn btn-quiet btn-small" disabled={isPending} onClick={() => handleUndo(notice.undo!)}>
              {isPending ? "Undoing…" : "Undo"}
            </button>
          )}
          {notice.kind === "success" && notice.skipped.length > 0 && (
            <ul className="pa-skip-list">
              {notice.skipped.map((s) => (
                <li key={`${s.scoutId}:${s.adventureId}`}>
                  Skipped {s.scoutName} — {s.adventureName}:{" "}
                  {s.reason === "completed_after" ? "completed after the award date" : "already awarded or unchecked since this page loaded"}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {visible.length > 0 && (
        <div className="info-card no-print pa-bar">
          <div className="form-row" style={{ marginBottom: 0, alignItems: "flex-end" }}>
            <div className="form-field">
              <label htmlFor="pa-award-date">Award date</label>
              <input
                id="pa-award-date"
                type="date"
                required
                max={today}
                value={awardedDate}
                disabled={isPending}
                onChange={(e) => setAwardedDate(e.target.value)}
              />
            </div>
            <div className="form-field" style={{ flexGrow: 0 }}>
              <button
                type="button"
                className="btn btn-primary btn-small"
                disabled={isPending || willAward === 0 || !!dateProblem}
                onClick={handleAward}
              >
                {isPending ? "Saving…" : `Mark ${plural(willAward, "award")} as Awarded`}
              </button>
            </div>
          </div>
          {dateProblem && awardedDate && <p className="form-error" style={{ marginBottom: 0 }}>{dateProblem}</p>}
          {willSkip.length > 0 && (
            <div className="form-note pa-skip-preview">
              {plural(willSkip.length, "ticked award was", "ticked awards were")} completed after{" "}
              {formatDateOnly(awardedDate)} and will be skipped:
              <ul className="pa-skip-list">
                {willSkip.map((i) => (
                  <li key={i.key}>
                    {i.scoutName} — {i.adventureName} (completed {formatDateOnly(i.completedDate)})
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="segmented pa-bar-tools" style={{ marginBottom: 0, alignItems: "center" }}>
            <GroupCheckbox
              keys={visible.map((i) => i.key)}
              selected={selected}
              onChange={setKeys}
              disabled={isPending}
              label={`Select all shown (${visible.length})`}
            />
            {chosen.length > 0 && (
              <button type="button" className="btn-link" disabled={isPending} onClick={() => setSelected(new Set())}>
                Clear selection ({chosen.length})
              </button>
            )}
          </div>
        </div>
      )}

      <div className="segmented no-print pa-view-switch" role="tablist" aria-label="View">
        <button
          type="button"
          role="tab"
          aria-selected={view === "scout"}
          className={`btn btn-small ${view === "scout" ? "btn-primary" : "btn-quiet"}`}
          onClick={() => setView("scout")}
        >
          By scout
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "award"}
          className={`btn btn-small ${view === "award" ? "btn-primary" : "btn-quiet"}`}
          onClick={() => setView("award")}
        >
          By award
        </button>
        {/* What to buy at the Scout Shop (and, in the PDF, a hand-out checklist) — on both views. */}
        <FileExportButton className="btn btn-quiet btn-small" href={`/api/awards/export?${exportQuery}`} label="Shopping list CSV" />
        <FileExportButton className="btn btn-quiet btn-small" href={`/api/awards/export/pdf?${exportQuery}`} label="Shopping list PDF" />
        {view === "award" && (
          <>
            <FileExportButton
              className="btn btn-quiet btn-small"
              href={`/api/awards/ranks?${ranksExportQuery}`}
              label="Ranks awarded CSV"
            />
          </>
        )}
      </div>

      {visible.length === 0 && (
        <div className="info-card">
          {hasFilters
            ? "Nothing pending matches these filters."
            : "Nothing is waiting to be awarded — every completed adventure has its award date."}
        </div>
      )}

      {view === "scout" &&
        byScout.map((den) => (
          <section key={den.denId} className="pa-den">
            <div className="pa-den-head">
              <h3>
                {den.denName} <span className="badge-pill badge-den badge-count">{den.count}</span>
              </h3>
              <GroupCheckbox
                keys={den.scouts.flatMap((s) => s.items.map((i) => i.key))}
                selected={selected}
                onChange={setKeys}
                disabled={isPending}
                label="Select all in this den"
              />
              {denLinks[den.denId] && (
                <Link className="btn btn-quiet btn-small" href={denLinks[den.denId]}>
                  Open den
                </Link>
              )}
            </div>
            <div className="pa-scout-grid">
              {den.scouts.map((scout) => (
                <div key={scout.scoutId} className="scout-card pa-scout">
                  <GroupCheckbox
                    keys={scout.items.map((i) => i.key)}
                    selected={selected}
                    onChange={setKeys}
                    disabled={isPending}
                    label={`${scout.scoutName} (${scout.items.length})`}
                  />
                  <ul className="pa-items">
                    {scout.items.map((item) => (
                      <li key={item.key}>
                        <label>
                          {itemCheckbox(item, `${item.adventureName} for ${scout.scoutName}`)}
                          <span>
                            <span className="pa-item-name">{item.adventureName}</span>
                            <span className="form-note">
                              {awardTypeLabel(item.adventureType)} · {item.kind === "rank" ? "earned" : "completed"}{" "}
                              {formatDateOnly(item.completedDate)}
                            </span>
                            {resolvedTag(item)}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ))}

      {view === "award" && byAward.length > 0 && (
        <>
          <p className="form-note">
            {plural(visible.length, "patch", "patches")} across {plural(byAward.length, "award")} — the count beside each is how
            many to pick up.
          </p>
          {byAward.map((group) => (
            <section key={group.key} className="info-card pa-award">
              <div className="pa-den-head">
                <h3>
                  {group.adventureType === null ? group.adventureName : `${RANK_INFO[group.rank].label} — ${group.adventureName}`}{" "}
                  <span className="badge-pill badge-den badge-count" aria-label={`${group.items.length} needed`}>
                    {group.items.length}
                  </span>
                </h3>
                <GroupCheckbox
                  keys={group.items.map((i) => i.key)}
                  selected={selected}
                  onChange={setKeys}
                  disabled={isPending}
                  label="Select all for this award"
                />
              </div>
              <div className="table-scroll">
                <table className="data-table cards-md">
                  <thead>
                    <tr>
                      <th>Scout</th>
                      <th>Den</th>
                      <th>Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item) => (
                      <tr key={item.key}>
                        <td>
                          <label className="aa-scout">
                            {itemCheckbox(item, `${group.adventureName} for ${item.scoutName}`)}
                            <span>
                              {item.scoutName} {resolvedTag(item)}
                            </span>
                          </label>
                        </td>
                        <td data-label="Den">{item.denName}</td>
                        <td data-label="Completed" style={{ whiteSpace: "nowrap" }}>
                          {formatDateOnly(item.completedDate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      )}

      {heldBack.length > 0 && (
        <details className="info-card pa-held">
          <summary>
            <strong>{plural(heldBack.length, "completed adventure is", "completed adventures are")} held back</strong> — flagged on
            the advancement audit
          </summary>
          <p className="form-note">
            Their dates don&apos;t add up yet (or an Admin sent them back for correction), so they can&apos;t be awarded in bulk.
            Fix the dates on the den page{auditHref ? ", or have an Admin resolve the flag on the audit page" : ""}; they&apos;ll
            show up above once they&apos;re clean.{" "}
            {auditHref && <Link href={auditHref}>Open the audit page</Link>}
          </p>
          <ul className="pa-skip-list">
            {heldBack.map((item) => (
              <li key={item.key}>
                {item.scoutName} ({item.denName}) — {item.adventureName}:{" "}
                {item.discrepancies.map((d) => DISCREPANCY_LABELS[d]).join(", ") || "sent back for correction"}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
