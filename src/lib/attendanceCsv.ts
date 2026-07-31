import "server-only";
import { formatMeetingDate } from "@/lib/attendanceSchedule";
import { escapeCsvField } from "@/lib/csv";
import { RANK_INFO } from "@/lib/rankConfig";
import type { Rank } from "@/generated/prisma/enums";

export type AttendanceCsvRow = {
  scoutingYear: string;
  rank: Rank;
  label: string;
  firstName: string;
  lastName: string;
  date: Date;
  present: boolean | null;
};

export function buildAttendanceCsv(rows: AttendanceCsvRow[]): string {
  const header = ["Scouting Year", "Den", "Scout First Name", "Scout Last Name", "Meeting Date", "Status"];
  const lines = [header.join(",")];

  for (const row of rows) {
    const denName = `${RANK_INFO[row.rank].label}${row.label ? ` ${row.label}` : ""}`;
    const status = row.present === true ? "Present" : row.present === false ? "Absent" : "Not Recorded";
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
