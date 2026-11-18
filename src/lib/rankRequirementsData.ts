import "server-only";
import { prisma } from "@/lib/prisma";
import type { AdventureType, Rank } from "@/generated/prisma/enums";
import { buildRequirementTree, type RequirementNode } from "@/lib/requirementProgress";

export type PublicAdventure = {
  id: string;
  name: string;
  type: AdventureType;
  /** Short note shown beside the name in the portal, e.g. a range activity's council requirement. */
  note: string | null;
  /** Another way to earn it (religious emblem). */
  requirementsNote: string | null;
  requirementsPick: number | null;
  requirements: RequirementNode[];
};

/**
 * Every adventure of every rank with its official requirements, for the
 * public Rank Requirements page — the same list leaders check off in the
 * portal. Required adventures first, then electives, each in checklist order.
 */
export async function getAdventuresByRank(): Promise<Map<Rank, PublicAdventure[]>> {
  const adventures = await prisma.adventure.findMany({
    orderBy: [{ rank: "asc" }, { sortOrder: "asc" }],
    select: {
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
    },
  });

  const byRank = new Map<Rank, PublicAdventure[]>();
  const typeOrder: Record<AdventureType, number> = { REQUIRED: 0, ELECTIVE: 1 };
  for (const adventure of [...adventures].sort(
    (a, b) => typeOrder[a.type] - typeOrder[b.type] || a.sortOrder - b.sortOrder,
  )) {
    const list = byRank.get(adventure.rank) ?? [];
    list.push({
      id: adventure.id,
      name: adventure.name,
      type: adventure.type,
      note: adventure.note,
      requirementsNote: adventure.requirementsNote,
      requirementsPick: adventure.requirementsPick,
      requirements: buildRequirementTree(adventure.requirements),
    });
    byRank.set(adventure.rank, list);
  }
  return byRank;
}
