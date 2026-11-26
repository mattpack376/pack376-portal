import type { AdventureType, Rank } from "@/generated/prisma/enums";
import { isDateOnlyString } from "@/lib/dateOnly";
import { RANK_ORDER } from "@/lib/rankConfig";
import type {
  AdvancementAuditRecord,
  AdvancementAuditStatus,
  AdvancementDiscrepancyType,
} from "@/lib/advancementAuditRules";

/*
 * The rules behind Pending Awards (/portal/awards): which adventures are
 * waiting to be handed out, how the screen filters and groups them, and the
 * checks on a bulk award request. Pure functions over plain data so they can
 * be unit tested; the loading is in pendingAwardsData.ts and the writes in
 * src/lib/actions/advancement.ts.
 *
 * "Pending" starts from the audit page's own checks (advancementAuditData.ts),
 * so the two pages can't disagree: an adventure the audit calls "Ready for
 * award" is exactly one this screen offers. One an Admin resolved on the audit
 * page (its odd dates accepted) can be awarded here too. One still flagged, or
 * sent back for correction, is listed as held back instead — its dates need
 * fixing (or resolving) first, or awarding it from the scout's card.
 */

/** The most adventures one bulk award (or undo) may carry. A whole pack's Blue & Gold is a few hundred. */
export const MAX_AWARD_BATCH = 500;

/** Audit statuses that can be awarded in bulk. */
const AWARDABLE: readonly AdvancementAuditStatus[] = ["READY_FOR_AWARD", "RESOLVED"];

export type PendingAwardItem = {
  /** An adventure, or the scout's rank badge (adventureId "rank:WOLF", see rankItemId). */
  kind: "adventure" | "rank";
  /** scoutId + adventureId — what the checkboxes and the action use. */
  key: string;
  scoutId: string;
  scoutName: string;
  denId: string;
  denName: string;
  rank: Rank;
  adventureId: string;
  adventureName: string;
  /** Null for a rank badge. */
  adventureType: AdventureType | null;
  sortOrder: number;
  /** YYYY-MM-DD. For a rank badge, the day it was earned. */
  completedDate: string;
  auditStatus: AdvancementAuditStatus;
  discrepancies: AdvancementDiscrepancyType[];
};

export const pendingAwardKey = (scoutId: string, adventureId: string) => `${scoutId}:${adventureId}`;

/** A completed adventure with a completion date and no award date yet. */
export function isPendingAward(record: Pick<AdvancementAuditRecord, "completed" | "completedDate" | "awardedDate">) {
  return record.completed && !!record.completedDate && !record.awardedDate;
}

/** Splits the audit's records into what can be awarded now and what's held back by an open flag. */
export function toPendingItems(records: readonly AdvancementAuditRecord[]): {
  awardable: PendingAwardItem[];
  heldBack: PendingAwardItem[];
} {
  const awardable: PendingAwardItem[] = [];
  const heldBack: PendingAwardItem[] = [];
  for (const r of records) {
    if (!isPendingAward(r)) continue;
    const item: PendingAwardItem = {
      kind: r.kind,
      key: pendingAwardKey(r.scoutId, r.adventureId),
      scoutId: r.scoutId,
      scoutName: r.scoutName,
      denId: r.denId,
      denName: r.denName,
      rank: r.rank,
      adventureId: r.adventureId,
      adventureName: r.adventureName,
      adventureType: r.adventureType,
      sortOrder: r.sortOrder,
      completedDate: r.completedDate as string,
      auditStatus: r.status,
      discrepancies: r.discrepancies,
    };
    (AWARDABLE.includes(r.status) ? awardable : heldBack).push(item);
  }
  return { awardable: sortItems(awardable), heldBack: sortItems(heldBack) };
}

const rankIndex = (rank: Rank) => RANK_ORDER.indexOf(rank);

/** Den (by rank, then name), scout, then the checklist's own order. */
function sortItems(items: PendingAwardItem[]) {
  return items.sort(
    (a, b) =>
      rankIndex(a.rank) - rankIndex(b.rank) ||
      a.denName.localeCompare(b.denName) ||
      a.scoutName.localeCompare(b.scoutName, "en", { sensitivity: "base" }) ||
      a.scoutId.localeCompare(b.scoutId) ||
      a.sortOrder - b.sortOrder,
  );
}

export const AWARD_TYPE_FILTERS = { all: "Adventures and ranks", adventures: "Adventures", ranks: "Rank badges" } as const;
export type AwardTypeFilter = keyof typeof AWARD_TYPE_FILTERS;

export type PendingAwardFilters = {
  denId: string | null;
  type: AwardTypeFilter;
  /** An adventure's name, matched exactly — "Bobcat" picks every rank's Bobcat. */
  adventure: string | null;
  /** YYYY-MM-DD: completed on or before this day. */
  before: string | null;
};

export type PendingAwardSearchParams = Partial<Record<"denId" | "type" | "adventure" | "before", string | string[]>>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function parsePendingAwardFilters(params: PendingAwardSearchParams): PendingAwardFilters {
  const denId = one(params.denId);
  const adventure = one(params.adventure)?.trim();
  const before = one(params.before);
  const type = one(params.type);
  return {
    denId: denId && denId.length <= 64 ? denId : null,
    type: type && Object.hasOwn(AWARD_TYPE_FILTERS, type) ? (type as AwardTypeFilter) : "all",
    adventure: adventure && adventure.length <= 120 ? adventure : null,
    before: before && isDateOnlyString(before) ? before : null,
  };
}

export function pendingAwardQuery(filters: PendingAwardFilters): URLSearchParams {
  const query = new URLSearchParams();
  if (filters.denId) query.set("denId", filters.denId);
  if (filters.type !== "all") query.set("type", filters.type);
  if (filters.adventure) query.set("adventure", filters.adventure);
  if (filters.before) query.set("before", filters.before);
  return query;
}

export function filterPendingItems<T extends PendingAwardItem>(items: readonly T[], filters: PendingAwardFilters): T[] {
  return items.filter(
    (item) =>
      (!filters.denId || item.denId === filters.denId) &&
      (filters.type === "all" || (filters.type === "ranks") === (item.kind === "rank")) &&
      (!filters.adventure || item.adventureName === filters.adventure) &&
      (!filters.before || item.completedDate <= filters.before),
  );
}

/** Every adventure name with something pending, for the filter's dropdown. */
export function adventureNameOptions(items: readonly PendingAwardItem[]): string[] {
  return [...new Set(items.map((i) => i.adventureName))].sort((a, b) => a.localeCompare(b));
}

export type PendingScoutGroup = { scoutId: string; scoutName: string; items: PendingAwardItem[] };
export type PendingDenGroup = { denId: string; denName: string; rank: Rank; scouts: PendingScoutGroup[]; count: number };

/** By scout: each den, its scouts, and each scout's pending adventures. Keeps the order given (sortItems). */
export function groupByScout(items: readonly PendingAwardItem[]): PendingDenGroup[] {
  const dens = new Map<string, PendingDenGroup>();
  for (const item of items) {
    let den = dens.get(item.denId);
    if (!den) {
      den = { denId: item.denId, denName: item.denName, rank: item.rank, scouts: [], count: 0 };
      dens.set(item.denId, den);
    }
    let scout = den.scouts.find((s) => s.scoutId === item.scoutId);
    if (!scout) {
      scout = { scoutId: item.scoutId, scoutName: item.scoutName, items: [] };
      den.scouts.push(scout);
    }
    scout.items.push(item);
    den.count += 1;
  }
  return [...dens.values()];
}

export type PendingAwardGroup = {
  /** rank + adventure name: every rank has its own Bobcat patch. */
  key: string;
  rank: Rank;
  adventureName: string;
  adventureType: AdventureType | null;
  sortOrder: number;
  items: PendingAwardItem[];
};

/** By award: each rank's adventure with the scouts waiting on it — the Scout Shop list. */
export function groupByAward(items: readonly PendingAwardItem[]): PendingAwardGroup[] {
  const groups = new Map<string, PendingAwardGroup>();
  for (const item of items) {
    const key = `${item.rank}:${item.adventureName}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        rank: item.rank,
        adventureName: item.adventureName,
        adventureType: item.adventureType,
        sortOrder: item.sortOrder,
        items: [],
      };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return [...groups.values()].sort(
    (a, b) => rankIndex(a.rank) - rankIndex(b.rank) || a.sortOrder - b.sortOrder || a.adventureName.localeCompare(b.adventureName),
  );
}

/** Why an award date can't be used, or null when it can. `today` is YYYY-MM-DD in the pack's time zone. */
export function awardDateProblem(awardedDate: unknown, today: string): string | null {
  if (typeof awardedDate !== "string" || !awardedDate.trim()) return "Enter the date the awards were handed out.";
  if (!isDateOnlyString(awardedDate)) return "That award date isn't a real date.";
  if (awardedDate > today) return "The award date can't be in the future.";
  return null;
}

/** The items an award date would skip: they were completed after it. */
export function completedAfter<T extends { completedDate: string | null }>(items: readonly T[], awardedDate: string): T[] {
  return items.filter((i) => !!i.completedDate && i.completedDate > awardedDate);
}

export type AwardItemInput = { scoutId: string; adventureId: string };

export type AwardRequest = { items: AwardItemInput[]; awardedDate: string; scoutIds: string[] };

const UNREADABLE = "Those awards couldn't be read. Reload the page and try again.";

const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 64;

/**
 * Checks a bulk award request before anything is read: a list of
 * { scoutId, adventureId } (each pair once — repeats collapse), at most
 * MAX_AWARD_BATCH, and a usable award date. `scoutIds` comes back sorted, the
 * order the action locks them in.
 */
export function readAwardRequest(
  items: unknown,
  awardedDate: unknown,
  today: string,
): { ok: true; request: AwardRequest } | { ok: false; error: string } {
  if (!Array.isArray(items)) return { ok: false, error: UNREADABLE };
  if (items.length === 0) return { ok: false, error: "Tick at least one award first." };
  if (items.length > MAX_AWARD_BATCH) {
    return { ok: false, error: `That's too many at once — ${MAX_AWARD_BATCH} awards at most. Award them a den at a time.` };
  }
  const byKey = new Map<string, AwardItemInput>();
  for (const raw of items) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: UNREADABLE };
    const { scoutId, adventureId } = raw as Record<string, unknown>;
    if (!isId(scoutId) || !isId(adventureId)) return { ok: false, error: UNREADABLE };
    byKey.set(pendingAwardKey(scoutId, adventureId), { scoutId, adventureId });
  }
  const dateError = awardDateProblem(awardedDate, today);
  if (dateError) return { ok: false, error: dateError };
  const list = [...byKey.values()];
  return {
    ok: true,
    request: { items: list, awardedDate: awardedDate as string, scoutIds: [...new Set(list.map((i) => i.scoutId))].sort() },
  };
}

/**
 * What the Undo button sends back: the award date the batch used and, for each
 * adventure it awarded, the record's updatedAt right after the batch saved it.
 * Undo clears only the records still exactly like that — awarded on that date,
 * by the same person, not saved since.
 */
export type AwardUndoToken = {
  awardedDate: string;
  items: { scoutId: string; adventureId: string; updatedAt: string }[];
};

export type UndoRequest = {
  awardedDate: string;
  items: { scoutId: string; adventureId: string; updatedAt: Date }[];
  scoutIds: string[];
};

export function readUndoRequest(token: unknown): { ok: true; request: UndoRequest } | { ok: false; error: string } {
  const bad = { ok: false as const, error: "That undo couldn't be read. Reload the page and check the awards on the scouts' cards." };
  if (typeof token !== "object" || token === null || Array.isArray(token)) return bad;
  const { awardedDate, items } = token as Record<string, unknown>;
  if (typeof awardedDate !== "string" || !isDateOnlyString(awardedDate)) return bad;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_AWARD_BATCH) return bad;
  const byKey = new Map<string, UndoRequest["items"][number]>();
  for (const raw of items) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return bad;
    const { scoutId, adventureId, updatedAt } = raw as Record<string, unknown>;
    if (!isId(scoutId) || !isId(adventureId) || typeof updatedAt !== "string" || updatedAt.length > 40) return bad;
    const at = new Date(updatedAt);
    if (Number.isNaN(at.getTime())) return bad;
    byKey.set(pendingAwardKey(scoutId, adventureId), { scoutId, adventureId, updatedAt: at });
  }
  const list = [...byKey.values()];
  return { ok: true, request: { awardedDate, items: list, scoutIds: [...new Set(list.map((i) => i.scoutId))].sort() } };
}
