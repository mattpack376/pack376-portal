import "server-only";
import { prisma } from "@/lib/prisma";
import { ELECTIVES_REQUIRED } from "@/lib/rankConfig";
import type { AdventureType, Rank } from "@/generated/prisma/enums";

export type ChecklistAdventure = {
  id: string;
  name: string;
  type: AdventureType;
  sortOrder: number;
  note: string | null;
  completed: boolean;
  completedDate: Date | null;
  updatedAt: Date | null;
  updatedByUsername: string | null;
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
};

type ScoutWithRecords = {
  id: string;
  firstName: string;
  lastName: string;
  records: {
    adventureId: string;
    completed: boolean;
    completedDate: Date | null;
    updatedAt: Date;
    updatedByUser: { username: string } | null;
  }[];
};

type AdventureRow = {
  id: string;
  name: string;
  type: AdventureType;
  sortOrder: number;
  note: string | null;
};

function toChecklistScout(scout: ScoutWithRecords, adventures: AdventureRow[]): ChecklistScout {
  const recordByAdventureId = new Map(scout.records.map((r) => [r.adventureId, r]));
  const list: ChecklistAdventure[] = adventures.map((adv) => {
    const rec = recordByAdventureId.get(adv.id);
    return {
      id: adv.id,
      name: adv.name,
      type: adv.type,
      sortOrder: adv.sortOrder,
      note: adv.note,
      completed: rec?.completed ?? false,
      completedDate: rec?.completedDate ?? null,
      updatedAt: rec?.updatedAt ?? null,
      updatedByUsername: rec?.updatedByUser?.username ?? null,
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
  };
}

export async function getDenChecklist(denId: string) {
  const den = await prisma.den.findUnique({
    where: { id: denId },
    include: {
      scouts: {
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        include: { records: { include: { updatedByUser: { select: { username: true } } } } },
      },
    },
  });
  if (!den) return null;

  const adventures = await prisma.adventure.findMany({
    where: { rank: den.rank },
    orderBy: { sortOrder: "asc" },
  });

  const scouts: ChecklistScout[] = den.scouts.map((scout) => toChecklistScout(scout, adventures));

  return { den, scouts };
}

/** Read-only advancement checklist for an arbitrary set of scouts (e.g. a parent's linked kids), which may span more than one den/rank. */
export async function getScoutsAdvancementByIds(scoutIds: string[]): Promise<ChecklistScout[]> {
  if (scoutIds.length === 0) return [];

  const scouts = await prisma.scout.findMany({
    where: { id: { in: scoutIds } },
    orderBy: [{ firstName: "asc" }],
    include: { den: true, records: { include: { updatedByUser: { select: { username: true } } } } },
  });
  if (scouts.length === 0) return [];

  const ranks = Array.from(new Set(scouts.map((s) => s.den.rank))) as Rank[];
  const adventures = await prisma.adventure.findMany({
    where: { rank: { in: ranks } },
    orderBy: { sortOrder: "asc" },
  });
  const adventuresByRank = new Map<Rank, AdventureRow[]>();
  for (const adv of adventures) {
    const list = adventuresByRank.get(adv.rank) ?? [];
    list.push(adv);
    adventuresByRank.set(adv.rank, list);
  }

  return scouts.map((scout) => toChecklistScout(scout, adventuresByRank.get(scout.den.rank) ?? []));
}
