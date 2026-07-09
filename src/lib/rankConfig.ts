import type { Rank } from "@/generated/prisma/enums";

export const RANK_ORDER: Rank[] = ["LION", "TIGER", "WOLF", "BEAR", "WEBELOS", "AOL"];

export const RANK_INFO: Record<Rank, { label: string; grade: string; badgeClass: string }> = {
  LION: { label: "Lion", grade: "Kindergarten", badgeClass: "rk-lion" },
  TIGER: { label: "Tiger", grade: "1st Grade", badgeClass: "rk-tiger" },
  WOLF: { label: "Wolf", grade: "2nd Grade", badgeClass: "rk-wolf" },
  BEAR: { label: "Bear", grade: "3rd Grade", badgeClass: "rk-bear" },
  WEBELOS: { label: "Webelos", grade: "4th Grade", badgeClass: "rk-webelos" },
  AOL: { label: "Arrow of Light", grade: "5th Grade", badgeClass: "rk-aol" },
};

/** Electives required is uniform across all ranks — verified against the pack's advancement tracker. */
export const ELECTIVES_REQUIRED = 2;

export function nextRank(rank: Rank): Rank | null {
  const idx = RANK_ORDER.indexOf(rank);
  if (idx === -1 || idx === RANK_ORDER.length - 1) return null;
  return RANK_ORDER[idx + 1];
}

export function denDisplayName(rank: Rank, scoutingYear: string, label: string) {
  const suffix = label ? ` ${label}` : "";
  return `${RANK_INFO[rank].label}${suffix} Den — ${scoutingYear}`;
}
