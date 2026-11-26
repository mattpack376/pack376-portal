import "server-only";
import { prisma } from "@/lib/prisma";
import { ELECTIVES_REQUIRED } from "@/lib/rankConfig";
import { toDateOnlyString } from "@/lib/dateOnly";
import type { AdventureType, Rank } from "@/generated/prisma/enums";
import type { RequirementRow } from "@/lib/requirementProgress";
import { loadRankStatuses, type ScoutRankStatus } from "@/lib/rankStatus";

/** One requirement as the card shows it: the official text plus this scout's check. */
export type ChecklistRequirement = RequirementRow & {
  completed: boolean;
  /** YYYY-MM-DD, or null when not checked. */
  completedDate: string | null;
};

export type ChecklistAdventure = {
  id: string;
  name: string;
  type: AdventureType;
  sortOrder: number;
  note: string | null;
  completed: boolean;
  /** YYYY-MM-DD, or null when never recorded — see @/lib/dateOnly. */
  completedDate: string | null;
  awardedDate: string | null;
  updatedAt: Date | null;
  updatedByUsername: string | null;
  /** Another way to earn the adventure (a religious emblem), shown above its requirements. */
  requirementsNote: string | null;
  /** Top-level requirements needed; null means all. */
  requirementsPick: number | null;
  /** Flat, in no particular order — the card builds the tree (@/lib/requirementProgress). */
  requirements: ChecklistRequirement[];
};

export type ChecklistScout = {
  id: string;
  firstName: string;
  lastName: string;
  requiredDone: number;
  requiredTotal: number;
  electivesDone: number;
  electivesRequired: number;
  adventures: ChecklistAdventure[];
  /** The den's rank badge: earned, awarded (and when), earlier seasons' ranks. See rankStatus.ts. */
  rankStatus: ScoutRankStatus | null;
};

type ScoutWithRecords = {
  id: string;
  firstName: string;
  lastName: string;
  records: {
    adventureId: string;
    completed: boolean;
    completedDate: Date | null;
    awardedDate: Date | null;
    updatedAt: Date;
    updatedByUser: { username: string } | null;
  }[];
  requirementRecords: { requirementId: string; completed: boolean; completedDate: Date | null }[];
};

type AdventureRow = {
  id: string;
  name: string;
  type: AdventureType;
  sortOrder: number;
  note: string | null;
  requirementsNote: string | null;
  requirementsPick: number | null;
  requirements: RequirementRow[];
};

/** What every checklist query loads for an adventure, requirements included. */
const ADVENTURE_SELECT = {
  id: true,
  rank: true,
  name: true,
  type: true,
  sortOrder: true,
  note: true,
  requirementsNote: true,
  requirementsPick: true,
  requirements: {
    select: { id: true, parentId: true, code: true, text: true, pick: true, isGroup: true, sortOrder: true },
  },
} as const;

/** A scout's requirement checks, loaded alongside their adventure records. */
const REQUIREMENT_RECORDS_INCLUDE = {
  select: { requirementId: true, completed: true, completedDate: true },
} as const;

function toChecklistScout(
  scout: ScoutWithRecords,
  adventures: AdventureRow[],
  rankStatus: ScoutRankStatus | null,
): ChecklistScout {
  const recordByAdventureId = new Map(scout.records.map((r) => [r.adventureId, r]));
  const requirementRecordById = new Map(scout.requirementRecords.map((r) => [r.requirementId, r]));
  const list: ChecklistAdventure[] = adventures.map((adv) => {
    const rec = recordByAdventureId.get(adv.id);
    return {
      id: adv.id,
      name: adv.name,
      type: adv.type,
      sortOrder: adv.sortOrder,
      note: adv.note,
      completed: rec?.completed ?? false,
      completedDate: toDateOnlyString(rec?.completedDate),
      awardedDate: toDateOnlyString(rec?.awardedDate),
      updatedAt: rec?.updatedAt ?? null,
      updatedByUsername: rec?.updatedByUser?.username ?? null,
      requirementsNote: adv.requirementsNote,
      requirementsPick: adv.requirementsPick,
      requirements: adv.requirements.map((req) => {
        const check = requirementRecordById.get(req.id);
        const completed = check?.completed ?? false;
        return { ...req, completed, completedDate: completed ? toDateOnlyString(check?.completedDate) : null };
      }),
    };
  });
  const required = list.filter((a) => a.type === "REQUIRED");
  const electives = list.filter((a) => a.type === "ELECTIVE");

  return {
    id: scout.id,
    firstName: scout.firstName,
    lastName: scout.lastName,
    requiredDone: required.filter((a) => a.completed).length,
    requiredTotal: required.length,
    electivesDone: electives.filter((a) => a.completed).length,
    electivesRequired: ELECTIVES_REQUIRED,
    adventures: list,
    rankStatus,
  };
}

export async function getDenChecklist(denId: string) {
  const den = await prisma.den.findUnique({
    where: { id: denId },
    include: {
      scouts: {
        // Inactive scouts drop off the checklist; their records stay on file.
        where: { active: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        include: {
          records: { include: { updatedByUser: { select: { username: true } } } },
          requirementRecords: REQUIREMENT_RECORDS_INCLUDE,
        },
      },
    },
  });
  if (!den) return null;

  const inactiveScouts = await prisma.scout.findMany({
    where: { denId, active: false },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: { id: true, firstName: true, lastName: true },
  });

  const adventures = await prisma.adventure.findMany({
    where: { rank: den.rank },
    orderBy: { sortOrder: "asc" },
    select: ADVENTURE_SELECT,
  });

  // Sorted here rather than trusting the DB collation, so "alex" doesn't land after "Zane".
  const byName = (a: { firstName: string; lastName: string }, b: { firstName: string; lastName: string }) =>
    a.firstName.localeCompare(b.firstName, "en", { sensitivity: "base" }) ||
    a.lastName.localeCompare(b.lastName, "en", { sensitivity: "base" });

  const rankStatuses = await loadRankStatuses(den.scouts.map((s) => s.id));
  const scouts: ChecklistScout[] = den.scouts
    .map((scout) => toChecklistScout(scout, adventures, rankStatuses.get(scout.id) ?? null))
    .sort(byName);
  inactiveScouts.sort(byName);

  return { den, scouts, inactiveScouts };
}

/** Read-only advancement checklist for an arbitrary set of scouts (e.g. a parent's linked kids), which may span more than one den/rank. */
export async function getScoutsAdvancementByIds(scoutIds: string[]): Promise<ChecklistScout[]> {
  // Deduped: a repeated id in a Prisma `in:` list breaks included relations (adapter-pg).
  const ids = [...new Set(scoutIds)];
  if (ids.length === 0) return [];

  const scouts = await prisma.scout.findMany({
    where: { id: { in: ids }, active: true },
    orderBy: [{ firstName: "asc" }],
    include: {
      den: true,
      records: { include: { updatedByUser: { select: { username: true } } } },
      requirementRecords: REQUIREMENT_RECORDS_INCLUDE,
    },
  });
  if (scouts.length === 0) return [];

  /*
   * Scout.den is a required relation, so this filter should never drop
   * anything — but a row whose denId points at a den that is no longer there
   * comes back with den: null and used to throw here. This runs on the Parent
   * Dashboard, where that meant one bad row 500'd a family's whole page
   * instead of costing them one checklist. Skip the scout, keep the page.
   */
  const withDen = scouts.filter((s) => s.den !== null);
  if (withDen.length === 0) return [];

  const ranks = Array.from(new Set(withDen.map((s) => s.den.rank))) as Rank[];
  const adventures = await prisma.adventure.findMany({
    where: { rank: { in: ranks } },
    orderBy: { sortOrder: "asc" },
    select: ADVENTURE_SELECT,
  });
  const adventuresByRank = new Map<Rank, AdventureRow[]>();
  for (const adv of adventures) {
    const list = adventuresByRank.get(adv.rank) ?? [];
    list.push(adv);
    adventuresByRank.set(adv.rank, list);
  }

  const rankStatuses = await loadRankStatuses(withDen.map((s) => s.id));
  return withDen.map((scout) =>
    toChecklistScout(scout, adventuresByRank.get(scout.den.rank) ?? [], rankStatuses.get(scout.id) ?? null),
  );
}
