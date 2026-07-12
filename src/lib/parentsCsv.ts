import "server-only";
import { RANK_INFO } from "@/lib/rankConfig";
import type { Rank } from "@/generated/prisma/enums";

export type ParentCsvRow = {
  scoutingYear: string;
  rank: Rank;
  label: string;
  firstName: string;
  lastName: string;
  parentName: string;
  parentEmail: string | null;
  parentPhone: string | null;
};

function csvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildParentsCsv(rows: ParentCsvRow[]): string {
  const header = [
    "Scouting Year",
    "Den",
    "Scout First Name",
    "Scout Last Name",
    "Parent Name",
    "Parent Email",
    "Parent Phone",
  ];
  const lines = [header.join(",")];

  for (const row of rows) {
    const denName = `${RANK_INFO[row.rank].label}${row.label ? ` ${row.label}` : ""}`;
    lines.push(
      [
        csvField(row.scoutingYear),
        csvField(denName),
        csvField(row.firstName),
        csvField(row.lastName),
        csvField(row.parentName),
        csvField(row.parentEmail ?? ""),
        csvField(row.parentPhone ?? ""),
      ].join(",")
    );
  }

  return lines.join("\n");
}
