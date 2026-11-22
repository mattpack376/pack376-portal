import "server-only";
import { escapeCsvField } from "@/lib/csv";
import { formatPhoneNumber } from "@/lib/phone";
import type { LeaderContactSection } from "@/lib/adultLeaderAttendanceData";

/**
 * The Leaders & Committee contact list as a CSV: one row per person, in the
 * order the tracker shows them (Committee, then Pack & Den Leaders). Same
 * rows as the PDF and the Printable View.
 */
export function buildLeaderContactsCsv(sections: LeaderContactSection[]): string {
  const lines = [["Section", "Name", "Positions", "Email", "Phone"].join(",")];

  for (const { label, people } of sections) {
    for (const person of people) {
      lines.push(
        [
          escapeCsvField(label),
          escapeCsvField(person.name),
          // Semicolons, not the "·" the portal shows: plain text that reads
          // the same in any spreadsheet (same as the leader attendance CSV).
          escapeCsvField(person.positions.join("; ")),
          escapeCsvField(person.email ?? ""),
          escapeCsvField(person.phone ? formatPhoneNumber(person.phone) : ""),
        ].join(",")
      );
    }
  }

  return lines.join("\n");
}
