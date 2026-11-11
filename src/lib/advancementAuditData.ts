import "server-only";
import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/session";
import type { AdventureType, Rank } from "@/generated/prisma/enums";
import { RANK_INFO, RANK_ORDER } from "@/lib/rankConfig";
import { isDateOnlyString, toDateOnlyString, todayDateOnly } from "@/lib/dateOnly";
import { scoutingYearForDate } from "@/lib/attendanceSchedule";
import { isAdvancementAuditEditor } from "@/lib/authorize";
import {
  AUDIT_STATUS_FILTERS,
  auditRecord,
  hasEarnedRank,
  isAuditStatusFilter,
  statusMatchesFilter,
  activeMark,
  type AdvancementAuditRecord,
  type AdvancementAuditStatus,
  type AuditStatusFilter,
} from "@/lib/advancementAuditRules";

/*
 * Loads Audits -> Advancement: every adventure record of the chosen season's
 * dens that the viewer may see, run through the checks in
 * advancementAuditRules.ts, then filtered and paged.
 *
 * The filtering happens here on the server, after the checks, because a
 * record's status depends on its dates and its Admin mark together — it isn't
 * a column the database could filter on. A pack's whole season is a few
 * thousand rows at most, which is quick to check in one pass.
 */

export const ADVANCEMENT_AUDIT_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_ADVANCEMENT_AUDIT_PAGE_SIZE = 25;
const MAX_QUERY_LENGTH = 80;

/** The filter and paging state, as read from the page's search params. */
export type AdvancementAuditFilters = {
  /** "2026-2027". */
  year: string;
  denId: string | null;
  rank: Rank | null;
  status: AuditStatusFilter;
  /** YYYY-MM-DD, on the completion date. */
  from: string | null;
  to: string | null;
  /** Scout or adventure name, any part of it. */
  q: string | null;
  page: number;
  pageSize: number;
};

export type AdvancementAuditSearchParams = Partial<
  Record<"year" | "denId" | "rank" | "status" | "from" | "to" | "q" | "page" | "per", string | string[]>
>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function parseAdvancementAuditFilters(
  params: AdvancementAuditSearchParams,
  now: Date = new Date(),
): AdvancementAuditFilters {
  const year = one(params.year);
  const rank = one(params.rank);
  const status = one(params.status);
  const from = one(params.from);
  const to = one(params.to);
  const q = one(params.q)?.trim().slice(0, MAX_QUERY_LENGTH);
  const page = Number(one(params.page));
  const per = Number(one(params.per));
  const denId = one(params.denId);
  return {
    year: year && /^\d{4}-\d{4}$/.test(year) ? year : scoutingYearForDate(todayDateOnly(now)),
    denId: denId && denId.length <= 64 ? denId : null,
    rank: rank && (RANK_ORDER as string[]).includes(rank) ? (rank as Rank) : null,
    status: isAuditStatusFilter(status) ? status : "all",
    from: from && isDateOnlyString(from) ? from : null,
    to: to && isDateOnlyString(to) ? to : null,
    q: q || null,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: (ADVANCEMENT_AUDIT_PAGE_SIZES as readonly number[]).includes(per)
      ? per
      : DEFAULT_ADVANCEMENT_AUDIT_PAGE_SIZE,
  };
}

/** The filters as a query string — for links, the export buttons and the redirect after an action. */
export function advancementAuditQuery(
  filters: AdvancementAuditFilters,
  overrides: Partial<AdvancementAuditFilters> = {},
): URLSearchParams {
  const f = { ...filters, ...overrides };
  const query = new URLSearchParams();
  query.set("year", f.year);
  if (f.denId) query.set("denId", f.denId);
  if (f.rank) query.set("rank", f.rank);
  if (f.status !== "all") query.set("status", f.status);
  if (f.from) query.set("from", f.from);
  if (f.to) query.set("to", f.to);
  if (f.q) query.set("q", f.q);
  if (f.page > 1) query.set("page", String(f.page));
  if (f.pageSize !== DEFAULT_ADVANCEMENT_AUDIT_PAGE_SIZE) query.set("per", String(f.pageSize));
  return query;
}

export type AdvancementAuditMetrics = {
  /** Records checked (after the den, rank, date and name filters). */
  audited: number;
  /** Flagged or marked for correction — still waiting on someone. */
  needsReview: number;
  /** Of those, the ones an Admin sent back to the den leader. */
  needsCorrection: number;
  /** Every record that failed a check, including the resolved ones. */
  discrepancies: number;
  /** Complete, clean dates, badge not yet handed out. */
  readyForAward: number;
  /** Scouts who have finished their rank badge itself. */
  scoutsRankEarned: number;
};

/**
 * Which dens the viewer may audit. Admin and Junior Admin: every den. A Den
 * Leader: their assigned dens only.
 */
function denScope(session: SessionPayload, year: string) {
  return isAdvancementAuditEditor(session)
    ? { scoutingYear: year }
    : { scoutingYear: year, id: { in: session.denIds } };
}

/** "Wolf Den", "Bear B Den" — the season is already chosen on the page, so it's left off. */
function shortDenName(rank: Rank, label: string) {
  return `${RANK_INFO[rank].label}${label ? ` ${label}` : ""} Den`;
}

/** Every record in scope that passes the den, rank, date and name filters, checked, sorted, unpaged. */
export async function loadAdvancementAudit(session: SessionPayload, filters: AdvancementAuditFilters) {
  const today = todayDateOnly();
  const scope = denScope(session, filters.year);

  const [dens, yearRows] = await Promise.all([
    prisma.den.findMany({
      where: scope,
      orderBy: [{ rank: "asc" }, { label: "asc" }],
      include: {
        scouts: {
          where: { active: true },
          orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
          include: {
            records: {
              include: {
                adventure: true,
                updatedByUser: { select: { displayName: true } },
                auditMark: { include: { markedByUser: { select: { displayName: true } } } },
              },
            },
          },
        },
      },
    }),
    prisma.den.findMany({
      where: isAdvancementAuditEditor(session) ? {} : { id: { in: session.denIds } },
      distinct: ["scoutingYear"],
      select: { scoutingYear: true },
      orderBy: { scoutingYear: "desc" },
    }),
  ]);

  const ranks = Array.from(new Set(dens.map((d) => d.rank)));
  const adventures = await prisma.adventure.findMany({
    where: { rank: { in: ranks } },
    select: { rank: true, type: true, sortOrder: true },
  });
  const adventuresByRank = new Map<Rank, { type: AdventureType }[]>();
  for (const adventure of adventures) {
    adventuresByRank.set(adventure.rank, [...(adventuresByRank.get(adventure.rank) ?? []), adventure]);
  }

  const needle = filters.q?.toLowerCase() ?? null;
  const from = filters.from ? new Date(`${filters.from}T00:00:00Z`) : null;
  const to = filters.to ? new Date(`${filters.to}T00:00:00Z`) : null;

  const rows: AdvancementAuditRecord[] = [];
  const sortOrder = new Map<string, number>();
  let scoutsRankEarned = 0;

  for (const den of dens) {
    if (filters.denId && den.id !== filters.denId) continue;
    if (filters.rank && den.rank !== filters.rank) continue;
    const denName = shortDenName(den.rank, den.label);

    for (const scout of den.scouts) {
      const scoutName = `${scout.firstName} ${scout.lastName}`.trim();
      // Only this rank's adventures: the checklist never shows another
      // rank's, so a stray one couldn't be fixed from the den page anyway.
      const records = scout.records.filter((r) => r.adventure.rank === den.rank);

      const completedTypes = records.filter((r) => r.completed).map((r) => r.adventure.type);
      if (hasEarnedRank(adventuresByRank.get(den.rank) ?? [], completedTypes)) scoutsRankEarned += 1;

      for (const record of records) {
        if (from && (!record.completedDate || record.completedDate < from)) continue;
        if (to && (!record.completedDate || record.completedDate > to)) continue;
        if (needle && !scoutName.toLowerCase().includes(needle) && !record.adventure.name.toLowerCase().includes(needle)) {
          continue;
        }

        const markInput = record.auditMark
          ? { kind: record.auditMark.kind, recordUpdatedAt: record.auditMark.recordUpdatedAt }
          : null;
        const input = {
          completed: record.completed,
          completedDate: record.completedDate,
          awardedDate: record.awardedDate,
          updatedAt: record.updatedAt,
          scoutingYear: den.scoutingYear,
          mark: markInput,
        };
        const result = auditRecord(input, today);
        if (!result) continue;
        const mark = activeMark(input) && record.auditMark ? record.auditMark : null;

        rows.push({
          recordId: record.id,
          scoutId: scout.id,
          scoutName,
          denId: den.id,
          denName,
          rank: den.rank,
          adventureName: record.adventure.name,
          adventureType: record.adventure.type,
          completedDate: toDateOnlyString(record.completedDate),
          awardedDate: toDateOnlyString(record.awardedDate),
          enteredBy: record.updatedByUser?.displayName ?? null,
          updatedAt: record.updatedAt,
          status: result.status,
          discrepancies: result.discrepancies,
          mark: mark
            ? { kind: mark.kind, note: mark.note, by: mark.markedByUser?.displayName ?? null, at: mark.createdAt }
            : null,
        });
        sortOrder.set(record.id, record.adventure.sortOrder);
      }
    }
  }

  const metrics: AdvancementAuditMetrics = {
    audited: rows.length,
    needsReview: rows.filter((r) => statusMatchesFilter(r.status, "review")).length,
    needsCorrection: rows.filter((r) => r.status === "NEEDS_CORRECTION").length,
    discrepancies: rows.filter((r) => r.discrepancies.length > 0).length,
    readyForAward: rows.filter((r) => r.status === "READY_FOR_AWARD").length,
    scoutsRankEarned,
  };

  // What needs a person first, then by den, scout and the checklist's own order.
  const priority: Record<AdvancementAuditStatus, number> = {
    NEEDS_CORRECTION: 0,
    FLAGGED: 1,
    READY_FOR_AWARD: 2,
    RESOLVED: 3,
    AWARDED: 4,
  };
  const denOrder = new Map(dens.map((d, i) => [d.id, i]));
  const matching = rows
    .filter((r) => statusMatchesFilter(r.status, filters.status))
    .sort(
      (a, b) =>
        priority[a.status] - priority[b.status] ||
        (denOrder.get(a.denId) ?? 0) - (denOrder.get(b.denId) ?? 0) ||
        a.scoutName.localeCompare(b.scoutName) ||
        (sortOrder.get(a.recordId) ?? 0) - (sortOrder.get(b.recordId) ?? 0),
    );

  return {
    records: matching,
    metrics,
    dens: dens.map((d) => ({ id: d.id, name: shortDenName(d.rank, d.label), rank: d.rank })),
    years: Array.from(new Set([filters.year, ...yearRows.map((r) => r.scoutingYear)])).sort().reverse(),
  };
}

/** One page of the audit. */
export async function getAdvancementAuditPage(session: SessionPayload, filters: AdvancementAuditFilters) {
  const { records, ...rest } = await loadAdvancementAudit(session, filters);
  const total = records.length;
  const pageCount = Math.max(1, Math.ceil(total / filters.pageSize));
  const page = Math.min(filters.page, pageCount);
  const start = (page - 1) * filters.pageSize;
  return { ...rest, records: records.slice(start, start + filters.pageSize), total, page, pageCount };
}

export type AdvancementHistoryEntry = { at: Date; who: string; text: string };

/**
 * The change history of each record on the page, from the audit log: the
 * leader's saves of that adventure (before -> after), and every Admin mark.
 * Goes back as far as the log does (AUDIT_RETENTION_MONTHS).
 */
export async function getAdvancementHistory(
  records: Pick<AdvancementAuditRecord, "recordId" | "scoutId" | "adventureName">[],
): Promise<Map<string, AdvancementHistoryEntry[]>> {
  const history = new Map<string, AdvancementHistoryEntry[]>(records.map((r) => [r.recordId, []]));
  if (records.length === 0) return history;

  const entries = await prisma.auditLog.findMany({
    where: {
      OR: [
        { action: "advancement.update", entityType: "Scout", entityId: { in: [...new Set(records.map((r) => r.scoutId))] } },
        {
          action: { startsWith: "advancement.audit." },
          entityType: "AdvancementRecord",
          entityId: { in: records.map((r) => r.recordId) },
        },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 2000,
    select: { createdAt: true, actorDisplayName: true, action: true, entityId: true, summary: true, details: true },
  });

  for (const entry of entries) {
    if (entry.action === "advancement.update") {
      const details = Array.isArray(entry.details) ? (entry.details as { label?: unknown; from?: unknown; to?: unknown }[]) : [];
      for (const record of records) {
        if (record.scoutId !== entry.entityId) continue;
        for (const detail of details) {
          if (detail?.label !== record.adventureName) continue;
          history.get(record.recordId)?.push({
            at: entry.createdAt,
            who: entry.actorDisplayName,
            text: `${String(detail.from)} → ${String(detail.to)}`,
          });
        }
      }
    } else if (entry.entityId) {
      history.get(entry.entityId)?.push({ at: entry.createdAt, who: entry.actorDisplayName, text: entry.summary });
    }
  }
  return history;
}

export const STATUS_FILTER_OPTIONS = Object.entries(AUDIT_STATUS_FILTERS) as [AuditStatusFilter, string][];
