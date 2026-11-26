import type { AdventureType, Rank } from "@/generated/prisma/enums";
import { ELECTIVES_REQUIRED } from "@/lib/rankConfig";
import { requirementProgress, type RequirementNode } from "@/lib/requirementProgress";

/*
 * The checks behind Audits -> Advancement. Pure functions over plain data, so
 * the rules can be unit tested without a database; the loading, filtering and
 * paging live in src/lib/advancementAuditData.ts.
 *
 * The portal records advancement one adventure at a time: a leader ticks an
 * adventure complete with the date it was finished, and later types in the
 * date the badge was handed out. Under each adventure they may also check off
 * its requirements one by one, each with the date it was done. There is no
 * parent submission, approval step or outside sync, so every check here is
 * about what those dates say.
 */

/** Something about a record's dates that doesn't add up. */
export type AdvancementDiscrepancyType =
  | "MISSING_COMPLETED_DATE"
  | "FUTURE_COMPLETED_DATE"
  | "FUTURE_AWARDED_DATE"
  | "AWARDED_BEFORE_COMPLETED"
  | "AWARDED_NOT_COMPLETED"
  | "OUTSIDE_PROGRAM_YEAR"
  | "REQUIREMENTS_INCOMPLETE"
  | "FUTURE_REQUIREMENT_DATE"
  | "REQUIREMENT_AFTER_COMPLETED"
  | "RANK_NO_LONGER_EARNED"
  | "RANK_AWARDED_BEFORE_EARNED";

export const DISCREPANCY_LABELS: Record<AdvancementDiscrepancyType, string> = {
  MISSING_COMPLETED_DATE: "No completion date",
  FUTURE_COMPLETED_DATE: "Completed in the future",
  FUTURE_AWARDED_DATE: "Awarded in the future",
  AWARDED_BEFORE_COMPLETED: "Awarded before completed",
  AWARDED_NOT_COMPLETED: "Awarded but not complete",
  OUTSIDE_PROGRAM_YEAR: "Outside the scouting year",
  REQUIREMENTS_INCOMPLETE: "Requirements partly logged",
  FUTURE_REQUIREMENT_DATE: "Requirement dated in the future",
  REQUIREMENT_AFTER_COMPLETED: "Requirement done after completion",
  RANK_NO_LONGER_EARNED: "Rank awarded, no longer earned",
  RANK_AWARDED_BEFORE_EARNED: "Rank awarded before earned",
};

export const DISCREPANCY_HELP: Record<AdvancementDiscrepancyType, string> = {
  MISSING_COMPLETED_DATE: "Checked complete, but no date was recorded for when it was finished.",
  FUTURE_COMPLETED_DATE: "The completion date hasn't happened yet — probably a typo in the year or month.",
  FUTURE_AWARDED_DATE: "The award date hasn't happened yet — probably a typo, or entered ahead of a pack meeting.",
  AWARDED_BEFORE_COMPLETED: "The badge was handed out before the adventure was finished.",
  AWARDED_NOT_COMPLETED: "An award date is on file, but the adventure isn't checked complete.",
  OUTSIDE_PROGRAM_YEAR: "Completed before June 1 or after August 31 of this den's scouting year.",
  REQUIREMENTS_INCOMPLETE:
    "Checked complete, but only some of its requirements are logged. Log the rest, or resolve it if the scout finished them another way.",
  FUTURE_REQUIREMENT_DATE: "One of its requirements is dated after today — probably a typo in the year or month.",
  REQUIREMENT_AFTER_COMPLETED: "One of its requirements is dated after the day the adventure was marked complete.",
  RANK_NO_LONGER_EARNED:
    "The rank badge has an award date, but an adventure it needs has since been unchecked. The award is kept — recheck the adventure, or clear the award on the scout's card.",
  RANK_AWARDED_BEFORE_EARNED:
    "The rank badge's award date is before the last adventure it needs was completed.",
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

/** What a scout has logged under one adventure's requirements, as the checks need it. */
export type AuditRequirementInput = {
  /** Requirements the adventure lists; 0 means none on file, so nothing is checked. */
  listed: number;
  /** Whether the logged checks meet the adventure (its pick, lettered parts and groups counted). */
  allMet: boolean;
  /** The date of every requirement checked done. */
  dates: Date[];
  /** The adventure can be earned another way (a religious emblem), so partial logs are fine. */
  hasAlternative: boolean;
  /** The latest save of any of the scout's checks on this adventure, or null for none. */
  updatedAt: Date | null;
};

export type AuditRecordInput = {
  completed: boolean;
  completedDate: Date | null;
  awardedDate: Date | null;
  /** When the record was last edited — the adventure or any of its requirement checks (see lastEdited). */
  updatedAt: Date;
  /** "2026-2027" — the den's season. */
  scoutingYear: string;
  mark: AuditMarkInput | null;
  /** Omitted or null when the adventure has no requirements on file. */
  requirements?: AuditRequirementInput | null;
};

/**
 * Sums up one scout's requirement checks on one adventure. Legacy completions
 * (checked off before requirements were tracked) have no dates, so they are
 * never flagged for missing requirements — only a partial log is.
 */
export function summarizeRequirements(
  tree: readonly RequirementNode[],
  adventurePick: number | null,
  hasAlternative: boolean,
  checks: readonly { requirementId: string; completed: boolean; completedDate: Date | null; updatedAt: Date }[],
): AuditRequirementInput {
  const done = checks.filter((c) => c.completed);
  const progress = requirementProgress(tree, adventurePick, new Set(done.map((c) => c.requirementId)));
  let updatedAt: Date | null = null;
  for (const check of checks) if (!updatedAt || check.updatedAt > updatedAt) updatedAt = check.updatedAt;
  return {
    listed: progress.total,
    allMet: progress.allMet,
    dates: done.flatMap((c) => (c.completedDate ? [c.completedDate] : [])),
    hasAlternative,
    updatedAt,
  };
}

/** The later of an adventure record's own save and its requirement checks' — what an audit mark is pinned to. */
export function lastEdited(recordUpdatedAt: Date, requirements: AuditRequirementInput | null | undefined): Date {
  const other = requirements?.updatedAt;
  return other && other > recordUpdatedAt ? other : recordUpdatedAt;
}

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

  const req = record.requirements;
  if (req && req.listed > 0) {
    if (req.dates.length > 0 && !req.allMet && !req.hasAlternative) found.push("REQUIREMENTS_INCOMPLETE");
    if (req.dates.some((d) => d > today)) found.push("FUTURE_REQUIREMENT_DATE");
    // A future date is already flagged above; this one is about the past.
    if (completedDate && req.dates.some((d) => d > completedDate && d <= today)) {
      found.push("REQUIREMENT_AFTER_COMPLETED");
    }
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
  adventures: readonly { type: AdventureType }[],
  completedTypes: readonly AdventureType[],
): boolean {
  const requiredTotal = adventures.filter((a) => a.type === "REQUIRED").length;
  if (requiredTotal === 0) return false;
  const requiredDone = completedTypes.filter((t) => t === "REQUIRED").length;
  const electivesDone = completedTypes.filter((t) => t === "ELECTIVE").length;
  return requiredDone >= requiredTotal && electivesDone >= ELECTIVES_REQUIRED;
}

/**
 * Where a scout stands on their den's rank badge, from their adventure
 * records — the one rule every page uses (the card's pill, Pending Awards,
 * the audit page, the roster, the Parent Dashboard). `earnedDate` is the day
 * the last adventure the rank needs was completed: every required one plus
 * the earliest-completed electives that make up ELECTIVES_REQUIRED. It's null
 * until earned, and also when one of those adventures has no completion date.
 * Dates are YYYY-MM-DD strings, which compare correctly as text.
 */
export type RankProgress = {
  requiredDone: number;
  requiredTotal: number;
  electivesDone: number;
  electivesRequired: number;
  earned: boolean;
  earnedDate: string | null;
};

export function rankProgress(
  adventures: readonly { id: string; type: AdventureType }[],
  records: readonly { adventureId: string; completed: boolean; completedDate: string | null }[],
): RankProgress {
  const typeById = new Map(adventures.map((a) => [a.id, a.type]));
  const done = records.filter((r) => r.completed && typeById.has(r.adventureId));
  const completedTypes = done.map((r) => typeById.get(r.adventureId) as AdventureType);
  const earned = hasEarnedRank(adventures, completedTypes);
  const required = done.filter((r) => typeById.get(r.adventureId) === "REQUIRED");
  const electives = done.filter((r) => typeById.get(r.adventureId) === "ELECTIVE");

  let earnedDate: string | null = null;
  if (earned) {
    const datedElectives = electives
      .map((r) => r.completedDate)
      .filter((d): d is string => !!d)
      .sort()
      .slice(0, ELECTIVES_REQUIRED);
    const requiredDates = required.map((r) => r.completedDate);
    if (requiredDates.every((d) => !!d) && datedElectives.length >= ELECTIVES_REQUIRED) {
      earnedDate = [...(requiredDates as string[]), ...datedElectives].sort().at(-1) ?? null;
    }
  }
  return {
    requiredDone: required.length,
    requiredTotal: adventures.filter((a) => a.type === "REQUIRED").length,
    electivesDone: electives.length,
    electivesRequired: ELECTIVES_REQUIRED,
    earned,
    earnedDate,
  };
}

export type RankAuditInput = {
  earned: boolean;
  /** YYYY-MM-DD, see rankProgress. */
  earnedDate: string | null;
  /** YYYY-MM-DD, or null while the badge hasn't been handed out. */
  awardedDate: string | null;
  /** The later of the award's own save and the scout's adventure saves for this rank. */
  updatedAt: Date;
  mark: AuditMarkInput | null;
};

/** Every check a rank badge fails. `today` is YYYY-MM-DD in the pack's time zone. */
export function findRankDiscrepancies(input: RankAuditInput, today: string): AdvancementDiscrepancyType[] {
  const found: AdvancementDiscrepancyType[] = [];
  const { earned, earnedDate, awardedDate } = input;
  if (!awardedDate) {
    // Earned, but one of the adventures it rests on has no completion date —
    // that adventure is flagged too; the badge waits until it's fixed.
    if (earned && !earnedDate) found.push("MISSING_COMPLETED_DATE");
    return found;
  }
  if (!earned) found.push("RANK_NO_LONGER_EARNED");
  if (awardedDate > today) found.push("FUTURE_AWARDED_DATE");
  if (earned && earnedDate && awardedDate < earnedDate) found.push("RANK_AWARDED_BEFORE_EARNED");
  return found;
}

/** A rank badge's status on the audit page, or null when it's neither earned nor awarded. Same precedence as auditRecord. */
export function auditRank(
  input: RankAuditInput,
  today: string,
): { status: AdvancementAuditStatus; discrepancies: AdvancementDiscrepancyType[] } | null {
  if (!input.earned && !input.awardedDate) return null;
  const discrepancies = findRankDiscrepancies(input, today);
  const mark = activeMark(input);
  if (mark?.kind === "NEEDS_CORRECTION") return { status: "NEEDS_CORRECTION", discrepancies };
  if (discrepancies.length > 0) return { status: mark?.kind === "RESOLVED" ? "RESOLVED" : "FLAGGED", discrepancies };
  return { status: input.awardedDate ? "AWARDED" : "READY_FOR_AWARD", discrepancies };
}

/**
 * What a mark on a rank badge is pinned to: the award's own save, or any save
 * of the scout's adventures for that rank — unchecking one changes whether the
 * badge is still earned, so it has to reopen the mark.
 */
export function rankLastEdited(awardUpdatedAt: Date, records: readonly { updatedAt: Date }[]): Date {
  let latest = awardUpdatedAt;
  for (const r of records) if (r.updatedAt > latest) latest = r.updatedAt;
  return latest;
}

/** "Required", "Elective", or "Rank badge" for the badge itself. */
export function awardTypeLabel(type: AdventureType | null): string {
  return type === null ? "Rank badge" : type === "REQUIRED" ? "Required" : "Elective";
}

export const rankBadgeName = (rankLabel: string) => `${rankLabel} rank badge`;

/** The rank badge's id in Pending Awards and the award actions, where an adventure id would go. */
export const rankItemId = (rank: Rank) => `rank:${rank}`;

export function rankFromItemId(id: string): Rank | null {
  if (!id.startsWith("rank:")) return null;
  const rank = id.slice("rank:".length);
  return (["LION", "TIGER", "WOLF", "BEAR", "WEBELOS", "AOL"] as string[]).includes(rank) ? (rank as Rank) : null;
}

/** One row of the audit, as the page, the CSV and the PDF all see it. */
export type AdvancementAuditRecord = {
  /** An adventure, or the rank badge itself (one row per scout once it's earned or awarded). */
  kind: "adventure" | "rank";
  /**
   * The AdvancementRecord id; for a rank badge "rank:<ScoutRankAward id>", or
   * "rank-pending:<scoutId>" while it hasn't been awarded (nothing to mark yet).
   */
  recordId: string;
  scoutId: string;
  scoutName: string;
  denId: string;
  denName: string;
  rank: Rank;
  /** The adventure's id, or rankItemId(rank) for the badge. */
  adventureId: string;
  /** "Bobcat", or "Wolf rank badge". */
  adventureName: string;
  /** Null for the rank badge. */
  adventureType: AdventureType | null;
  /** The adventure's place in its rank's checklist (-1 for the badge, listed first). */
  sortOrder: number;
  /** For the badge: earned. */
  completed: boolean;
  /** YYYY-MM-DD or null. For the badge: the day it was earned (rankProgress). */
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
