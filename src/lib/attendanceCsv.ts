import "server-only";
import { formatMeetingDate } from "@/lib/attendanceSchedule";
import { escapeCsvField } from "@/lib/csv";
import { RANK_INFO } from "@/lib/rankConfig";
import { ADULT_LEADER_SECTION_LABELS } from "@/lib/adultLeaderSections";
import type { AdultLeaderSection, Rank } from "@/generated/prisma/enums";

export type AttendanceCsvRow = {
  scoutingYear: string;
  rank: Rank;
  label: string;
  firstName: string;
  lastName: string;
  date: Date;
  present: boolean | null;
};

function statusLabel(present: boolean | null) {
  return present === true ? "Present" : present === false ? "Absent" : "Not Recorded";
}

export function buildAttendanceCsv(rows: AttendanceCsvRow[]): string {
  const header = ["Scouting Year", "Den", "Scout First Name", "Scout Last Name", "Meeting Date", "Status"];
  const lines = [header.join(",")];

  for (const row of rows) {
    const denName = `${RANK_INFO[row.rank].label}${row.label ? ` ${row.label}` : ""}`;
    const status = statusLabel(row.present);
    lines.push(
      [
        escapeCsvField(row.scoutingYear),
        escapeCsvField(denName),
        escapeCsvField(row.firstName),
        escapeCsvField(row.lastName),
        escapeCsvField(formatMeetingDate(row.date)),
        escapeCsvField(status),
      ].join(",")
    );
  }

  return lines.join("\n");
}

export type AdultLeaderAttendanceCsvRow = {
  scoutingYear: string;
  section: AdultLeaderSection;
  name: string;
  positions: string[];
  date: Date;
  present: boolean | null;
};

export function buildAdultLeaderAttendanceCsv(rows: AdultLeaderAttendanceCsvRow[]): string {
  const header = ["Scouting Year", "Section", "Name", "Positions", "Meeting Date", "Status"];
  const lines = [header.join(",")];

  for (const row of rows) {
    lines.push(
      [
        escapeCsvField(row.scoutingYear),
        escapeCsvField(ADULT_LEADER_SECTION_LABELS[row.section]),
        escapeCsvField(row.name),
        // Semicolons, not the "·" the portal shows: Excel opens a BOM-less
        // UTF-8 file as Windows-1252 and would garble it.
        escapeCsvField(row.positions.join("; ")),
        escapeCsvField(formatMeetingDate(row.date)),
        escapeCsvField(statusLabel(row.present)),
      ].join(",")
    );
  }

  return lines.join("\n");
}
