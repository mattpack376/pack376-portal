import "server-only";
import type { SessionPayload } from "@/lib/session";
import { canViewPendingAwards, pendingAwardsDenIds } from "@/lib/authorize";
import { loadAdvancementAudit, parseAdvancementAuditFilters } from "@/lib/advancementAuditData";
import { scoutingYearForDate } from "@/lib/attendanceSchedule";
import { todayDateOnly } from "@/lib/dateOnly";
import {
  adventureNameOptions,
  filterPendingItems,
  toPendingItems,
  type PendingAwardFilters,
} from "@/lib/pendingAwardsRules";

/*
 * Loads Pending Awards: this scouting year's completed-but-not-awarded
 * adventures in the dens the viewer may award, through the audit page's own
 * loader (so "Ready for award" means the same thing on both pages), then the
 * screen's filters. Active scouts only — the audit loader already leaves
 * inactive scouts out. Throws for a role that has no access, so a caller that
 * forgot its guard still gets nothing.
 */
export async function loadPendingAwards(session: SessionPayload, filters: PendingAwardFilters, now: Date = new Date()) {
  if (!canViewPendingAwards(session)) throw new Error("Not authorized.");
  const denIds = pendingAwardsDenIds(session);
  const year = scoutingYearForDate(todayDateOnly(now));

  const { records, dens } = await loadAdvancementAudit(session, parseAdvancementAuditFilters({ year }, now), { denIds });
  const { awardable, heldBack } = toPendingItems(records);
  /*
   * The records are already limited to the viewer's dens, so a den filter for
   * any other den (an old link, a hand-edited URL) simply matches nothing.
   */
  return {
    year,
    dens,
    /** Every adventure name with something pending in the chosen den, for the dropdown. */
    adventureNames: adventureNameOptions(filterPendingItems(awardable, { denId: filters.denId, adventure: null, before: null })),
    items: filterPendingItems(awardable, filters),
    heldBack: filterPendingItems(heldBack, filters),
    /** Unfiltered — the same number as the audit page's "Ready for award" for this season. */
    readyForAwardTotal: awardable.filter((i) => i.auditStatus === "READY_FOR_AWARD").length,
  };
}
