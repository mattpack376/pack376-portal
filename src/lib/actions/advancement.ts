"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdvancementDenAccess } from "@/lib/authorize";
import { InvalidDateError, parseDateOnlyString } from "@/lib/dateOnly";
import { recordAudit, auditDate, EMPTY, type AuditDetail } from "@/lib/audit";
import type { SessionPayload } from "@/lib/session";

export type AdventureChange = {
  adventureId: string;
  completed: boolean;
  /** YYYY-MM-DD. Required when completed; ignored (and cleared) when not. */
  completedDate: string | null;
  /** YYYY-MM-DD, or null while the badge still hasn't been presented. */
  awardedDate: string | null;
};

/** One requirement's check inside an adventure (see model RequirementRecord). */
export type RequirementChange = {
  requirementId: string;
  completed: boolean;
  /** YYYY-MM-DD. Required when completed; ignored (and cleared) when not. */
  completedDate: string | null;
};

export type ApplyAdventureChangesResult = { ok: true } | { ok: false; error: string };

/**
 * The most changes one Apply can carry. A rank has about twenty adventures
 * and the card sends only the ones that changed, so this is far above any
 * real save; it turns away an oversized request before any database work.
 */
const MAX_CHANGES = 200;

/**
 * Requirement checks one Apply can carry. The biggest rank has about 150
 * requirements across all its adventures, so a card can't legitimately send
 * more than that.
 */
const MAX_REQUIREMENT_CHANGES = 400;

const UNREADABLE = "Those changes couldn't be read. Reload the page and try again.";

/** Something wrong with what was sent — returned as the card's error message, with nothing saved. */
class AdvancementInputError extends Error {}

type ParsedChange = { adventureId: string; completed: boolean; completedDate: Date | null; awardedDate: Date | null };

/**
 * A YYYY-MM-DD date from the card, or null when blank. Anything that isn't a
 * string (or null) or isn't a real calendar date fails the whole Apply.
 */
function readDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new AdvancementInputError(UNREADABLE);
  try {
    return parseDateOnlyString(value);
  } catch (error) {
    if (error instanceof InvalidDateError) {
      throw new AdvancementInputError("That date isn't valid — check the dates and try again.");
    }
    throw error;
  }
}

/**
 * One entry from the card. The action is called with whatever the request
 * carries, not what the TypeScript type says, so every field is checked.
 * Unchecking clears both dates — an adventure that isn't complete can't have
 * been completed or awarded — but dates sent with it still have to be well
 * formed.
 */
function readChange(raw: unknown): ParsedChange {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new AdvancementInputError(UNREADABLE);
  const { adventureId, completed, completedDate, awardedDate } = raw as Record<string, unknown>;
  if (typeof adventureId !== "string" || adventureId.length === 0 || adventureId.length > 64) {
    throw new AdvancementInputError(UNREADABLE);
  }
  if (typeof completed !== "boolean") throw new AdvancementInputError(UNREADABLE);

  const completedOn = readDate(completedDate);
  const awardedOn = readDate(awardedDate);
  if (!completed) return { adventureId, completed: false, completedDate: null, awardedDate: null };
  if (!completedOn) {
    throw new AdvancementInputError("A completion date is required for every adventure you check.");
  }
  // The dates dialog enforces this too; this keeps a hand-built request to it.
  if (awardedOn && awardedOn < completedOn) {
    throw new AdvancementInputError("The award date can't be before the completion date.");
  }
  return { adventureId, completed: true, completedDate: completedOn, awardedDate: awardedOn };
}

function sameChange(a: ParsedChange, b: ParsedChange) {
  return (
    a.completed === b.completed &&
    a.completedDate?.getTime() === b.completedDate?.getTime() &&
    a.awardedDate?.getTime() === b.awardedDate?.getTime()
  );
}

/**
 * Every change, each adventure once. The card never sends an adventure
 * twice; if a request does, identical copies collapse into one and copies
 * that disagree fail the whole Apply rather than letting whichever was
 * written last win.
 */
function readChanges(changes: unknown): ParsedChange[] {
  if (!Array.isArray(changes) || changes.length > MAX_CHANGES) throw new AdvancementInputError(UNREADABLE);
  const byAdventure = new Map<string, ParsedChange>();
  for (const raw of changes) {
    const change = readChange(raw);
    const earlier = byAdventure.get(change.adventureId);
    if (earlier && !sameChange(earlier, change)) {
      throw new AdvancementInputError(
        "The same adventure was changed twice in one save. Reload the page and try again.",
      );
    }
    byAdventure.set(change.adventureId, change);
  }
  return [...byAdventure.values()];
}

type ParsedRequirementChange = { requirementId: string; completed: boolean; completedDate: Date | null };

/** One requirement entry from the card, checked field by field like readChange. */
function readRequirementChange(raw: unknown): ParsedRequirementChange {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new AdvancementInputError(UNREADABLE);
  const { requirementId, completed, completedDate } = raw as Record<string, unknown>;
  if (typeof requirementId !== "string" || requirementId.length === 0 || requirementId.length > 64) {
    throw new AdvancementInputError(UNREADABLE);
  }
  if (typeof completed !== "boolean") throw new AdvancementInputError(UNREADABLE);
  const completedOn = readDate(completedDate);
  if (!completed) return { requirementId, completed: false, completedDate: null };
  if (!completedOn) throw new AdvancementInputError("A date is required for every requirement you check.");
  return { requirementId, completed: true, completedDate: completedOn };
}

/** Every requirement change, each requirement once — the same rule as readChanges. */
function readRequirementChanges(changes: unknown): ParsedRequirementChange[] {
  if (changes === undefined || changes === null) return [];
  if (!Array.isArray(changes) || changes.length > MAX_REQUIREMENT_CHANGES) throw new AdvancementInputError(UNREADABLE);
  const byRequirement = new Map<string, ParsedRequirementChange>();
  for (const raw of changes) {
    const change = readRequirementChange(raw);
    const earlier = byRequirement.get(change.requirementId);
    if (
      earlier &&
      (earlier.completed !== change.completed ||
        earlier.completedDate?.getTime() !== change.completedDate?.getTime())
    ) {
      throw new AdvancementInputError(
        "The same requirement was changed twice in one save. Reload the page and try again.",
      );
    }
    byRequirement.set(change.requirementId, change);
  }
  return [...byRequirement.values()];
}

function canEditDen(session: SessionPayload, denId: string) {
  try {
    assertAdvancementDenAccess(session, denId);
    return true;
  } catch {
    return false;
  }
}

export async function applyAdventureChangesAction(
  scoutId: string,
  changes: AdventureChange[],
  requirementChanges: RequirementChange[] = [],
): Promise<ApplyAdventureChangesResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not authorized." };
  if (typeof scoutId !== "string" || !scoutId || scoutId.length > 64) return { ok: false, error: "Scout not found." };

  /*
   * Everything sent is checked before anything is read or written: one bad
   * entry fails the whole Apply, not leaving half the card saved.
   */
  let parsed: ParsedChange[];
  let parsedRequirements: ParsedRequirementChange[];
  try {
    parsed = readChanges(changes);
    parsedRequirements = readRequirementChanges(requirementChanges);
  } catch (error) {
    if (error instanceof AdvancementInputError) return { ok: false, error: error.message };
    throw error;
  }
  if (parsed.length === 0 && parsedRequirements.length === 0) return { ok: true };

  // Someone who can't edit this den is turned away before taking any lock.
  const current = await prisma.scout.findUnique({ where: { id: scoutId }, select: { denId: true } });
  if (!current) return { ok: false, error: "Scout not found." };
  if (!canEditDen(session, current.denId)) return { ok: false, error: "Not authorized for this den." };

  let saved;
  try {
    saved = await prisma.$transaction(
      async (tx) => {
        /*
         * The scout's row is locked and re-read before checking anything
         * against it, so an Admin moving the scout to another den (or
         * switching them inactive) either lands first and is seen here, or
         * waits until this Apply is saved. Two Applies for one scout take
         * turns the same way.
         */
        await tx.$queryRaw`SELECT id FROM "Scout" WHERE id = ${scoutId} FOR UPDATE`;
        const scout = await tx.scout.findUnique({
          where: { id: scoutId },
          select: { denId: true, firstName: true, lastName: true, active: true, den: { select: { rank: true } } },
        });
        if (!scout) throw new AdvancementInputError("Scout not found.");
        if (!canEditDen(session, scout.denId)) throw new AdvancementInputError("Not authorized for this den.");
        if (!scout.active) {
          throw new AdvancementInputError(`${scout.firstName} is inactive — make them active to update advancement.`);
        }

        // Every adventure has to be one of this scout's rank — the checklist
        // only ever shows those, so anything else would be saved where no
        // one can see or undo it.
        const adventureIds = parsed.map((p) => p.adventureId);
        const adventures =
          adventureIds.length === 0
            ? []
            : await tx.adventure.findMany({
                where: { id: { in: adventureIds }, rank: scout.den.rank },
                select: { id: true, name: true },
              });
        if (adventures.length !== adventureIds.length) {
          throw new AdvancementInputError(
            "One or more of those adventures isn't part of this scout's rank. Reload the page and try again.",
          );
        }

        // The same rule for requirements, and each has to be one with its own
        // checkbox — not a "do two of these" group or a requirement whose
        // lettered parts are what get checked.
        const requirementIds = parsedRequirements.map((p) => p.requirementId);
        const requirements =
          requirementIds.length === 0
            ? []
            : await tx.adventureRequirement.findMany({
                where: { id: { in: requirementIds }, isGroup: false, adventure: { rank: scout.den.rank } },
                select: { id: true, code: true, adventure: { select: { name: true } }, _count: { select: { children: true } } },
              });
        if (requirements.length !== requirementIds.length || requirements.some((r) => r._count.children > 0)) {
          throw new AdvancementInputError(
            "One or more of those requirements isn't part of this scout's rank. Reload the page and try again.",
          );
        }

        // Read the current state before writing so the audit entry can show
        // what each adventure actually went from, and so an Apply that
        // re-submits untouched checkboxes doesn't log them as changes.
        const existing =
          adventureIds.length === 0
            ? []
            : await tx.advancementRecord.findMany({
                where: { scoutId, adventureId: { in: adventureIds } },
                select: { adventureId: true, completed: true, completedDate: true, awardedDate: true },
              });
        const existingRequirements =
          requirementIds.length === 0
            ? []
            : await tx.requirementRecord.findMany({
                where: { scoutId, requirementId: { in: requirementIds } },
                select: { requirementId: true, completed: true, completedDate: true },
              });

        for (const { adventureId, completed, completedDate, awardedDate } of parsed) {
          await tx.advancementRecord.upsert({
            where: { scoutId_adventureId: { scoutId, adventureId } },
            update: { completed, completedDate, awardedDate, updatedByUserId: session.userId },
            create: {
              scoutId,
              adventureId,
              completed,
              completedDate,
              awardedDate,
              updatedByUserId: session.userId,
            },
          });
        }
        for (const { requirementId, completed, completedDate } of parsedRequirements) {
          await tx.requirementRecord.upsert({
            where: { scoutId_requirementId: { scoutId, requirementId } },
            update: { completed, completedDate, updatedByUserId: session.userId },
            create: { scoutId, requirementId, completed, completedDate, updatedByUserId: session.userId },
          });
        }
        return { scout, adventures, existing, requirements, existingRequirements };
      },
      { timeout: 15_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (error instanceof AdvancementInputError) return { ok: false, error: error.message };
    throw error;
  }

  const { scout, adventures, existing, requirements, existingRequirements } = saved;
  const adventureName = new Map(adventures.map((a) => [a.id, a.name]));
  const priorByAdventure = new Map(existing.map((r) => [r.adventureId, r]));
  const scoutName = `${scout.firstName} ${scout.lastName}`;
  const details: AuditDetail[] = [];
  for (const change of parsed) {
    const prior = priorByAdventure.get(change.adventureId);
    const from = describeAdventureState(prior?.completed ?? false, prior?.completedDate ?? null, prior?.awardedDate ?? null);
    const to = describeAdventureState(change.completed, change.completedDate, change.awardedDate);
    if (from === to) continue;
    details.push({ label: adventureName.get(change.adventureId) ?? change.adventureId, from, to });
  }
  const adventureDetails = details.length;

  const requirementLabel = new Map(
    requirements.map((r) => [r.id, `${r.adventure.name} · requirement ${r.code}`]),
  );
  const priorByRequirement = new Map(existingRequirements.map((r) => [r.requirementId, r]));
  for (const change of parsedRequirements) {
    const prior = priorByRequirement.get(change.requirementId);
    const from = describeRequirementState(prior?.completed ?? false, prior?.completedDate ?? null);
    const to = describeRequirementState(change.completed, change.completedDate);
    if (from === to) continue;
    details.push({ label: requirementLabel.get(change.requirementId) ?? change.requirementId, from, to });
  }
  const requirementDetails = details.length - adventureDetails;

  if (details.length > 0) {
    const counted = [
      adventureDetails > 0 ? `${adventureDetails} adventure${adventureDetails === 1 ? "" : "s"}` : null,
      requirementDetails > 0 ? `${requirementDetails} requirement${requirementDetails === 1 ? "" : "s"}` : null,
    ].filter(Boolean);
    const summary =
      details.length === 1
        ? `${details[0].to === EMPTY ? "Cleared" : "Updated"} “${details[0].label}” for ${scoutName}`
        : `Updated ${counted.join(" and ")} for ${scoutName}`;
    await recordAudit(session, {
      action: "advancement.update",
      summary,
      entityType: "Scout",
      entityId: scoutId,
      denId: scout.denId,
      details,
    });
  }

  revalidatePath("/portal/den");
  revalidatePath(`/portal/admin/dens/${scout.denId}`);
  return { ok: true };
}

/** One requirement's state as a single audit string: "Done Sep 10, 2026". */
function describeRequirementState(completed: boolean, completedDate: Date | null): string {
  return completed ? `Done ${auditDate(completedDate)}` : EMPTY;
}

/** One adventure's state as a single audit string: "Complete Sep 10, 2026 · awarded Oct 1, 2026". */
function describeAdventureState(completed: boolean, completedDate: Date | null, awardedDate: Date | null): string {
  if (!completed) return EMPTY;
  const parts = [`Complete ${auditDate(completedDate)}`];
  if (awardedDate) parts.push(`awarded ${auditDate(awardedDate)}`);
  return parts.join(" · ");
}
