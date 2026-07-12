import "server-only";
import { prisma } from "@/lib/prisma";
import { ELECTIVES_REQUIRED } from "@/lib/rankConfig";
import type { AdventureType } from "@/generated/prisma/enums";

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

  const scouts: ChecklistScout[] = den.scouts.map((scout) => {
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
  });

  return { den, scouts };
}
