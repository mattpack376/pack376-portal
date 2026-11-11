import type { AdventureType, Rank } from "@/generated/prisma/enums";
import { ELECTIVES_REQUIRED } from "@/lib/rankConfig";

/*
 * The checks behind Audits -> Advancement. Pure functions over plain data, so
 * the rules can be unit tested without a database; the loading, filtering and
 * paging live in src/lib/advancementAuditData.ts.
 *
 * The portal records advancement one adventure at a time: a leader ticks an
 * adventure complete with the date it was finished, and later types in the
 * date the badge was handed out. There is no parent submission, approval step
 * or outside sync, so every check here is about what those dates say.
 */

/** Something about a record's dates that doesn't add up. */
export type AdvancementDiscrepancyType =
  | "MISSING_COMPLETED_DATE"
  | "FUTURE_COMPLETED_DATE"
  | "FUTURE_AWARDED_DATE"
  | "AWARDED_BEFORE_COMPLETED"
  | "AWARDED_NOT_COMPLETED"
  | "OUTSIDE_PROGRAM_YEAR";

export const DISCREPANCY_LABELS: Record<AdvancementDiscrepancyType, string> = {
  MISSING_COMPLETED_DATE: "No completion date",
  FUTURE_COMPLETED_DATE: "Completed in the future",
  FUTURE_AWARDED_DATE: "Awarded in the future",
  AWARDED_BEFORE_COMPLETED: "Awarded before completed",
  AWARDED_NOT_COMPLETED: "Awarded but not complete",
  OUTSIDE_PROGRAM_YEAR: "Outside the scouting year",
};

export const DISCREPANCY_HELP: Record<AdvancementDiscrepancyType, string> = {
  MISSING_COMPLETED_DATE: "Checked complete, but no date was recorded for when it was finished.",
  FUTURE_COMPLETED_DATE: "The completion date hasn't happened yet — probably a typo in the year or month.",
  FUTURE_AWARDED_DATE: "The award date hasn't happened yet — probably a typo, or entered ahead of a pack meeting.",
  AWARDED_BEFORE_COMPLETED: "The badge was handed out before the adventure was finished.",
  AWARDED_NOT_COMPLETED: "An award date is on file, but the adventure isn't checked complete.",
  OUTSIDE_PROGRAM_YEAR: "Completed before June 1 or after August 31 of this den's scouting year.",
};

/** Where a record stands on the audit page. */
export type AdvancementAuditStatus =
  /** A check failed and nobody has looked at it yet. */
  | "FLAGGED"
  /** An Admin asked the den leader to fix it, and it hasn't been edited since. */
  | "NEEDS_CORRECTION"
  /** A check failed, and an Admin accepted it as it is. */
  | "RESOLVED"
  /** Complete with clean dates; the badge hasn't been handed out yet. */
  | "READY_FOR_AWARD"
  /** Complete and awarded, nothing to look at. */
  | "AWARDED";

export const STATUS_LABELS: Record<AdvancementAuditStatus, string> = {
  FLAGGED: "Flagged",
  NEEDS_CORRECTION: "Needs correction",
  RESOLVED: "Resolved",
  READY_FOR_AWARD: "Ready for award",
  AWARDED: "Awarded",
};

/** The status filter's choices. "Needs review" is everything someone still has to act on. */
export const AUDIT_STATUS_FILTERS = {
  all: "All",
  review: "Flagged / Needs Review",
  ready: "Ready for Award",
  awarded: "Awarded",
  resolved: "Resolved",
} as const;
export type AuditStatusFilter = keyof typeof AUDIT_STATUS_FILTERS;

export function isAuditStatusFilter(value: unknown): value is AuditStatusFilter {
  return typeof value === "string" && Object.hasOwn(AUDIT_STATUS_FILTERS, value);
}

export function statusMatchesFilter(status: AdvancementAuditStatus, filter: AuditStatusFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "review":
      return status === "FLAGGED" || status === "NEEDS_CORRECTION";
    case "ready":
      return status === "READY_FOR_AWARD";
    case "awarded":
      return status === "AWARDED";
    case "resolved":
      return status === "RESOLVED";
  }
}

export type AuditMarkInput = {
  kind: "RESOLVED" | "NEEDS_CORRECTION";
  /** The record's updatedAt when the mark was made. */
  recordUpdatedAt: Date;
};

export type AuditRecordInput = {
  completed: boolean;
  completedDate: Date | null;
  awardedDate: Date | null;
  updatedAt: Date;
  /** "2026-2027" — the den's season. */
  scoutingYear: string;
  mark: AuditMarkInput | null;
};

/** June 1 of the season's first year through August 31 of its second — the school year plus both summers' edges. */
export function programYearWindow(scoutingYear: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(\d{4})$/.exec(scoutingYear.trim());
  if (!m) return null;
  return { start: new Date(Date.UTC(Number(m[1]), 5, 1)), end: new Date(Date.UTC(Number(m[2]), 7, 31)) };
}

/** Every check this record fails. `today` is a date-only value (UTC midnight). */
export function findDiscrepancies(record: AuditRecordInput, today: Date): AdvancementDiscrepancyType[] {
  const found: AdvancementDiscrepancyType[] = [];
  const { completed, completedDate, awardedDate } = record;

  if (!completed) {
    if (awardedDate) found.push("AWARDED_NOT_COMPLETED");
    return found;
  }

  if (!completedDate) found.push("MISSING_COMPLETED_DATE");
  if (completedDate && completedDate > today) found.push("FUTURE_COMPLETED_DATE");
  if (awardedDate && awardedDate > today) found.push("FUTURE_AWARDED_DATE");
  if (completedDate && awardedDate && awardedDate < completedDate) found.push("AWARDED_BEFORE_COMPLETED");

  const window = programYearWindow(record.scoutingYear);
  if (completedDate && window && (completedDate < window.start || completedDate > window.end)) {
    found.push("OUTSIDE_PROGRAM_YEAR");
  }
  return found;
}

/**
 * A mark only counts while the record is exactly as it was when the mark was
 * made. Once a leader edits it, the record is judged on its new dates.
 */
export function activeMark(record: Pick<AuditRecordInput, "updatedAt" | "mark">): AuditMarkInput | null {
  if (!record.mark) return null;
  return record.updatedAt.getTime() > record.mark.recordUpdatedAt.getTime() ? null : record.mark;
}

/**
 * The record's status, or null when there's nothing to audit (an adventure
 * that was never completed, or was unchecked, with no stray award date).
 */
export function auditRecord(
  record: AuditRecordInput,
  today: Date,
): { status: AdvancementAuditStatus; discrepancies: AdvancementDiscrepancyType[] } | null {
  const discrepancies = findDiscrepancies(record, today);
  const mark = activeMark(record);

  if (mark?.kind === "NEEDS_CORRECTION") return { status: "NEEDS_CORRECTION", discrepancies };
  if (discrepancies.length > 0) {
    return { status: mark?.kind === "RESOLVED" ? "RESOLVED" : "FLAGGED", discrepancies };
  }
  if (!record.completed) return null;
  return { status: record.awardedDate ? "AWARDED" : "READY_FOR_AWARD", discrepancies };
}

/** Whether a scout has finished every required adventure and enough electives for the rank badge itself. */
export function hasEarnedRank(
  adventures: { type: AdventureType }[],
  completedTypes: AdventureType[],
): boolean {
  const requiredTotal = adventures.filter((a) => a.type === "REQUIRED").length;
  if (requiredTotal === 0) return false;
  const requiredDone = completedTypes.filter((t) => t === "REQUIRED").length;
  const electivesDone = completedTypes.filter((t) => t === "ELECTIVE").length;
  return requiredDone >= requiredTotal && electivesDone >= ELECTIVES_REQUIRED;
}

/** One row of the audit, as the page, the CSV and the PDF all see it. */
export type AdvancementAuditRecord = {
  recordId: string;
  scoutId: string;
  scoutName: string;
  denId: string;
  denName: string;
  rank: Rank;
  adventureName: string;
  adventureType: AdventureType;
  /** YYYY-MM-DD or null. */
  completedDate: string | null;
  awardedDate: string | null;
  /** Who last saved the record — a leader typing it in. */
  enteredBy: string | null;
  updatedAt: Date;
  status: AdvancementAuditStatus;
  discrepancies: AdvancementDiscrepancyType[];
  /** The Admin decision that's in force, if any. */
  mark: { kind: AuditMarkInput["kind"]; note: string; by: string | null; at: Date } | null;
};

/** Longest note an Admin can leave with a flag or resolution. */
export const MAX_AUDIT_NOTE_LENGTH = 500;
