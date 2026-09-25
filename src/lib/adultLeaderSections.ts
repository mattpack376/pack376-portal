import type { AdultLeaderSection } from "@/generated/prisma/enums";

/** Display order of the sections on every leader attendance screen. */
export const ADULT_LEADER_SECTIONS: AdultLeaderSection[] = ["COMMITTEE", "LEADERS"];

export const ADULT_LEADER_SECTION_LABELS: Record<AdultLeaderSection, string> = {
  COMMITTEE: "Committee",
  LEADERS: "Pack & Den Leaders",
};

export function isAdultLeaderSection(value: string): value is AdultLeaderSection {
  return (ADULT_LEADER_SECTIONS as string[]).includes(value);
}

/** "Cubmaster · Arrow of Light Den Leader" — how a person's positions read under their name. */
export function formatPositions(positions: string[]): string {
  return positions.join(" · ");
}
