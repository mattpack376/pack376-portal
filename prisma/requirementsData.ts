/**
 * Cub Scout adventure requirements, compiled one rank per file from
 * scouting.org into prisma/advancement-requirements/<rank>.json (the range
 * electives come from the official range lesson plans; each file's "notes"
 * say where and why).
 *
 * This module turns those files into flat AdventureRequirement rows with
 * stable ids, so the seed (a fresh local database) and the generated
 * migration (production) write identical rows. Change the JSON, then run
 * `npx tsx scripts/generateRequirementsSql.ts <migration name>` for a new
 * migration; never edit an applied migration.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Rank } from "../src/generated/prisma/enums";

export const REQUIREMENT_RANKS: Rank[] = ["LION", "TIGER", "WOLF", "BEAR", "WEBELOS", "AOL"];

type JsonRequirement = {
  code: string;
  text: string;
  pick: number | null;
  group?: boolean;
  children: JsonRequirement[];
};

type JsonAdventure = {
  portalName: string;
  officialName: string;
  type: "REQUIRED" | "ELECTIVE";
  sourceUrl: string;
  pick: number | null;
  note?: string;
  requirements: JsonRequirement[];
};

type JsonRankFile = { rank: Rank; adventures: JsonAdventure[] };

export type RequirementRow = {
  id: string;
  rank: Rank;
  adventureName: string;
  parentId: string | null;
  code: string;
  text: string;
  pick: number | null;
  isGroup: boolean;
  sortOrder: number;
};

export type AdventureNoteRow = {
  rank: Rank;
  adventureName: string;
  /** How else the adventure can be earned (e.g. a religious emblem), or null. */
  requirementsNote: string | null;
  /** How many top-level requirements are needed; null means all of them. */
  requirementsPick: number | null;
};

/** Same rank + adventure + code always gets the same id, wherever the row is written. */
export function requirementId(rank: Rank, adventureName: string, code: string): string {
  const hash = createHash("sha256").update(`${rank}\u0000${adventureName}\u0000${code}`).digest("hex");
  return `areq_${hash.slice(0, 24)}`;
}

function readRankFile(rank: Rank): JsonRankFile {
  const file = path.join(__dirname, "advancement-requirements", `${rank.toLowerCase()}.json`);
  const parsed = JSON.parse(readFileSync(file, "utf8")) as JsonRankFile;
  if (parsed.rank !== rank) throw new Error(`${file} says rank ${parsed.rank}, expected ${rank}`);
  return parsed;
}

/** Every requirement row, parents before their children, plus each adventure's note/pick. */
export function loadRequirementRows(): { requirements: RequirementRow[]; adventures: AdventureNoteRow[] } {
  const requirements: RequirementRow[] = [];
  const adventures: AdventureNoteRow[] = [];

  for (const rank of REQUIREMENT_RANKS) {
    for (const adventure of readRankFile(rank).adventures) {
      adventures.push({
        rank,
        adventureName: adventure.portalName,
        requirementsNote: adventure.note ?? null,
        requirementsPick: adventure.pick,
      });
      const seen = new Set<string>();
      const walk = (nodes: JsonRequirement[], parentId: string | null) => {
        nodes.forEach((node, index) => {
          if (seen.has(node.code)) {
            throw new Error(`${rank} ${adventure.portalName}: requirement code "${node.code}" appears twice`);
          }
          seen.add(node.code);
          if (node.pick !== null && (node.pick < 1 || node.pick > node.children.length)) {
            throw new Error(`${rank} ${adventure.portalName} ${node.code}: pick ${node.pick} doesn't fit its children`);
          }
          const id = requirementId(rank, adventure.portalName, node.code);
          requirements.push({
            id,
            rank,
            adventureName: adventure.portalName,
            parentId,
            code: node.code,
            text: node.text,
            pick: node.pick,
            isGroup: node.group === true,
            sortOrder: index + 1,
          });
          walk(node.children, id);
        });
      };
      walk(adventure.requirements, null);
      if (adventure.pick !== null && (adventure.pick < 1 || adventure.pick > adventure.requirements.length)) {
        throw new Error(`${rank} ${adventure.portalName}: pick ${adventure.pick} doesn't fit its requirements`);
      }
    }
  }
  return { requirements, adventures };
}
