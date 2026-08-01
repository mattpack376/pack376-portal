import "server-only";
import { escapeCsvField } from "@/lib/csv";
import { formatPhoneNumber } from "@/lib/phone";
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
        escapeCsvField(row.scoutingYear),
        escapeCsvField(denName),
        escapeCsvField(row.firstName),
        escapeCsvField(row.lastName),
        escapeCsvField(row.parentName),
        escapeCsvField(row.parentEmail ?? ""),
        escapeCsvField(row.parentPhone ? formatPhoneNumber(row.parentPhone) : ""),
      ].join(",")
    );
  }

  return lines.join("\n");
}
