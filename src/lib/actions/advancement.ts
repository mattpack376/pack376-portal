"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdvancementDenAccess } from "@/lib/authorize";
import { InvalidDateError, parseDateOnlyString, todayDateOnlyString } from "@/lib/dateOnly";
import { recordAudit, auditDate, EMPTY, type AuditDetail } from "@/lib/audit";
import type { SessionPayload } from "@/lib/session";
import { Prisma } from "@/generated/prisma/client";
import type { Rank } from "@/generated/prisma/enums";
import { RANK_INFO } from "@/lib/rankConfig";
import { rankBadgeName, rankFromItemId, rankItemId } from "@/lib/advancementAuditRules";
import { rankProgressFor } from "@/lib/rankStatus";
import {
  awardDateProblem,
  pendingAwardKey,
  readAwardRequest,
  readUndoRequest,
  type AwardItemInput,
  type AwardUndoToken,
} from "@/lib/pendingAwardsRules";

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

// ---- Bulk award (Pending Awards, and the card's "Award all pending") ----

export type AwardSkip = {
  scoutId: string;
  adventureId: string;
  scoutName: string;
  adventureName: string;
  /** completed_after: finished after the award date. not_pending: already awarded, or unchecked, since the page loaded. */
  reason: "completed_after" | "not_pending";
};

export type AwardPendingResult =
  | {
      ok: true;
      /** Adventures marked awarded, and how many scouts they belong to. */
      awarded: number;
      scouts: number;
      awardedDate: string;
      skipped: AwardSkip[];
      /** Null when nothing was awarded. */
      undo: AwardUndoToken | null;
    }
  | { ok: false; error: string };

export type UndoAwardResult =
  | {
      ok: true;
      cleared: number;
      scouts: number;
      /** Named in the undo but saved by someone since (or no longer awarded that day), so left as they are. */
      changedSince: number;
      /** pendingAwardKey of each record cleared. */
      clearedKeys: string[];
    }
  | { ok: false; error: string };

type LockedScout = { id: string; denId: string; firstName: string; lastName: string; active: boolean; den: { rank: string } };

/**
 * Locks every scout in `scoutIds` (sorted — the same order every batch takes
 * them in, so two batches can't each hold one scout the other is waiting for)
 * and re-checks each one the way Apply Changes does: still there, still in a
 * den this session may edit, still active. Any one failing fails the batch.
 */
async function lockScoutsForAdvancement(tx: Prisma.TransactionClient, session: SessionPayload, scoutIds: string[]) {
  await tx.$queryRaw`SELECT id FROM "Scout" WHERE id IN (${Prisma.join(scoutIds)}) ORDER BY id FOR UPDATE`;
  const scouts: LockedScout[] = await tx.scout.findMany({
    where: { id: { in: scoutIds } },
    select: { id: true, denId: true, firstName: true, lastName: true, active: true, den: { select: { rank: true } } },
  });
  if (scouts.length !== scoutIds.length) {
    throw new AdvancementInputError("One or more of those scouts couldn't be found. Reload the page and try again.");
  }
  for (const scout of scouts) {
    if (!canEditDen(session, scout.denId)) throw new AdvancementInputError("Not authorized for this den.");
    if (!scout.active) {
      throw new AdvancementInputError(
        `${scout.firstName} ${scout.lastName} is inactive — make them active to update advancement. Nothing was saved.`,
      );
    }
  }
  return new Map(scouts.map((s) => [s.id, s]));
}

/** Turns away, before any lock, a request naming a scout this session can't edit. */
async function precheckScouts(session: SessionPayload, scoutIds: string[]): Promise<string | null> {
  const found = await prisma.scout.findMany({ where: { id: { in: scoutIds } }, select: { denId: true } });
  if (found.length !== scoutIds.length) return "One or more of those scouts couldn't be found. Reload the page and try again.";
  if (found.some((s) => !canEditDen(session, s.denId))) return "Not authorized for this den.";
  return null;
}

/**
 * Marks many scouts' completed adventures as awarded on one date. The same
 * rules as Apply Changes: everything sent is checked before anything is read,
 * the scouts are locked and re-checked inside the transaction, every adventure
 * must be one of its scout's rank, and the whole batch saves or none of it
 * does. It only ever sets awardedDate — completion and its date are left alone
 * — and only on records that are still complete and unawarded when it writes.
 * Adventures finished after the award date are skipped and listed back, as are
 * ones someone awarded or unchecked since the page loaded.
 */
export async function awardPendingAction(items: AwardItemInput[], awardedDate: string): Promise<AwardPendingResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not authorized." };

  const read = readAwardRequest(items, awardedDate, todayDateOnlyString());
  if (!read.ok) return read;
  const { request } = read;
  const awardedOn = parseDateOnlyString(request.awardedDate) as Date;

  const refusal = await precheckScouts(session, request.scoutIds);
  if (refusal) return { ok: false, error: refusal };

  let saved;
  try {
    saved = await prisma.$transaction(
      async (tx) => {
        const scouts = await lockScoutsForAdvancement(tx, session, request.scoutIds);

        // Rank badges ("rank:WOLF") and adventures travel in the same list.
        const rankItems = request.items.filter((i) => rankFromItemId(i.adventureId));
        const adventureItems = request.items.filter((i) => !rankFromItemId(i.adventureId));

        const adventureIds = [...new Set(adventureItems.map((i) => i.adventureId))];
        const adventures = await tx.adventure.findMany({
          where: { id: { in: adventureIds } },
          select: { id: true, name: true, rank: true },
        });
        const adventureById = new Map<string, { id: string; name: string; rank: Rank }>(adventures.map((a) => [a.id, a]));
        for (const item of adventureItems) {
          const adventure = adventureById.get(item.adventureId);
          if (!adventure || adventure.rank !== scouts.get(item.scoutId)?.den.rank) {
            throw new AdvancementInputError(
              "One or more of those adventures isn't part of its scout's rank. Reload the page and try again.",
            );
          }
        }
        for (const item of rankItems) {
          const rank = rankFromItemId(item.adventureId)!;
          if (rank !== scouts.get(item.scoutId)?.den.rank) {
            throw new AdvancementInputError(
              "One or more of those rank badges isn't its scout's rank. Reload the page and try again.",
            );
          }
          adventureById.set(item.adventureId, { id: item.adventureId, name: rankBadgeName(RANK_INFO[rank].label), rank });
        }

        const records = adventureItems.length
          ? await tx.advancementRecord.findMany({
              where: { OR: adventureItems.map((i) => ({ scoutId: i.scoutId, adventureId: i.adventureId })) },
              select: { id: true, scoutId: true, adventureId: true, completed: true, completedDate: true, awardedDate: true },
            })
          : [];
        const recordByKey = new Map(records.map((r) => [pendingAwardKey(r.scoutId, r.adventureId), r]));

        const skipped: AwardSkip[] = [];
        const label = (item: AwardItemInput) => {
          const scout = scouts.get(item.scoutId)!;
          return {
            scoutId: item.scoutId,
            adventureId: item.adventureId,
            scoutName: `${scout.firstName} ${scout.lastName}`,
            adventureName: adventureById.get(item.adventureId)!.name,
          };
        };

        // Rank badges: earned right now (judged under the locks), not already
        // awarded, and earned on or before the award date.
        const rankAwardsToCreate: { scoutId: string; rank: Rank; earnedDate: Date }[] = [];
        if (rankItems.length > 0) {
          const progress = await rankProgressFor(
            tx,
            rankItems.map((i) => ({ id: i.scoutId, rank: scouts.get(i.scoutId)!.den.rank as Rank })),
          );
          const existing = await tx.scoutRankAward.findMany({
            where: { OR: rankItems.map((i) => ({ scoutId: i.scoutId, rank: rankFromItemId(i.adventureId)! })) },
            select: { scoutId: true },
          });
          const alreadyAwarded = new Set(existing.map((e) => e.scoutId));
          for (const item of rankItems) {
            const p = progress.get(item.scoutId);
            if (!p?.earned || !p.earnedDate || alreadyAwarded.has(item.scoutId)) {
              skipped.push({ ...label(item), reason: "not_pending" });
            } else if (p.earnedDate > request.awardedDate) {
              skipped.push({ ...label(item), reason: "completed_after" });
            } else {
              rankAwardsToCreate.push({
                scoutId: item.scoutId,
                rank: rankFromItemId(item.adventureId)!,
                earnedDate: parseDateOnlyString(p.earnedDate) as Date,
              });
            }
          }
        }

        const toAward: typeof records = [];
        for (const item of adventureItems) {
          const record = recordByKey.get(pendingAwardKey(item.scoutId, item.adventureId));
          if (!record || !record.completed || !record.completedDate || record.awardedDate) {
            skipped.push({ ...label(item), reason: "not_pending" });
          } else if (record.completedDate > awardedOn) {
            skipped.push({ ...label(item), reason: "completed_after" });
          } else {
            toAward.push(record);
          }
        }

        if (toAward.length > 0) {
          await tx.advancementRecord.updateMany({
            // The completed/unawarded conditions repeat what was just read under
            // the scout locks, so a write can never land on anything else.
            where: { id: { in: toAward.map((r) => r.id) }, completed: true, awardedDate: null },
            data: { awardedDate: awardedOn, updatedByUserId: session.userId },
          });
        }
        const after = await tx.advancementRecord.findMany({
          where: { id: { in: toAward.map((r) => r.id) } },
          select: { scoutId: true, adventureId: true, updatedAt: true },
        });
        if (rankAwardsToCreate.length > 0) {
          // @@unique([scoutId, rank]) backs up the "not already awarded" check above.
          await tx.scoutRankAward.createMany({
            data: rankAwardsToCreate.map((r) => ({
              scoutId: r.scoutId,
              rank: r.rank,
              awardedDate: awardedOn,
              updatedByUserId: session.userId,
            })),
          });
          const created = await tx.scoutRankAward.findMany({
            where: { OR: rankAwardsToCreate.map((r) => ({ scoutId: r.scoutId, rank: r.rank })) },
            select: { scoutId: true, rank: true, updatedAt: true },
          });
          for (const c of created) after.push({ scoutId: c.scoutId, adventureId: rankItemId(c.rank), updatedAt: c.updatedAt });
        }
        const awardedRecords: AuditedAward[] = [
          ...toAward.map((r) => ({ scoutId: r.scoutId, adventureId: r.adventureId, completedDate: r.completedDate })),
          ...rankAwardsToCreate.map((r) => ({ scoutId: r.scoutId, adventureId: rankItemId(r.rank), completedDate: r.earnedDate })),
        ];
        return { scouts, adventureById, awardedRecords, skipped, after };
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (error instanceof AdvancementInputError) return { ok: false, error: error.message };
    throw error;
  }

  const { scouts, adventureById, awardedRecords, skipped, after } = saved;
  const awardedScouts = await auditAwardsByScout(session, scouts, adventureById, awardedRecords, (record) =>
    rankFromItemId(record.adventureId)
      ? { from: describeRankAward(null), to: describeRankAward(awardedOn) }
      : {
          from: describeAdventureState(true, record.completedDate, null),
          to: describeAdventureState(true, record.completedDate, awardedOn),
        },
  (list, name) => `Awarded ${describeAwardCount(list, adventureById)} for ${name} (award date ${auditDate(awardedOn)})`,
  );

  revalidateAdvancement(scouts);
  return {
    ok: true,
    awarded: awardedRecords.length,
    scouts: awardedScouts,
    awardedDate: request.awardedDate,
    skipped,
    undo:
      after.length === 0
        ? null
        : {
            awardedDate: request.awardedDate,
            items: after.map((r) => ({ scoutId: r.scoutId, adventureId: r.adventureId, updatedAt: r.updatedAt.toISOString() })),
          },
  };
}

/**
 * Undoes one bulk award: clears awardedDate back to empty on exactly the
 * records that batch set — still awarded on the batch's date, by this same
 * login, and not saved by anyone since (their updatedAt is unchanged). Any
 * other record named is left alone and counted as changed since. Locks and
 * checks the scouts the same way the award did.
 */
export async function undoAwardBatchAction(token: AwardUndoToken): Promise<UndoAwardResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not authorized." };
  const read = readUndoRequest(token);
  if (!read.ok) return read;
  const { request } = read;
  const awardedOn = parseDateOnlyString(request.awardedDate) as Date;

  const refusal = await precheckScouts(session, request.scoutIds);
  if (refusal) return { ok: false, error: refusal };

  let saved;
  try {
    saved = await prisma.$transaction(
      async (tx) => {
        const scouts = await lockScoutsForAdvancement(tx, session, request.scoutIds);
        const rankItems = request.items.filter((i) => rankFromItemId(i.adventureId));
        const adventureItems = request.items.filter((i) => !rankFromItemId(i.adventureId));

        // Rank badges: delete exactly the awards the batch created, untouched since.
        const rankAwards = rankItems.length
          ? await tx.scoutRankAward.findMany({
              where: { OR: rankItems.map((i) => ({ scoutId: i.scoutId, rank: rankFromItemId(i.adventureId)! })) },
              select: { id: true, scoutId: true, rank: true, awardedDate: true, updatedAt: true, updatedByUserId: true },
            })
          : [];
        const rankToClear: typeof rankAwards = [];
        for (const item of rankItems) {
          const award = rankAwards.find((a) => a.scoutId === item.scoutId && a.rank === rankFromItemId(item.adventureId));
          if (
            award &&
            award.awardedDate.getTime() === awardedOn.getTime() &&
            award.updatedByUserId === session.userId &&
            award.updatedAt.getTime() === item.updatedAt.getTime() &&
            award.rank === scouts.get(award.scoutId)?.den.rank
          ) {
            rankToClear.push(award);
          }
        }
        if (rankToClear.length > 0) {
          await tx.scoutRankAward.deleteMany({
            where: { id: { in: rankToClear.map((a) => a.id) }, awardedDate: awardedOn, updatedByUserId: session.userId },
          });
        }

        const records = adventureItems.length === 0 ? [] : await tx.advancementRecord.findMany({
          where: { OR: adventureItems.map((i) => ({ scoutId: i.scoutId, adventureId: i.adventureId })) },
          select: {
            id: true,
            scoutId: true,
            adventureId: true,
            completed: true,
            completedDate: true,
            awardedDate: true,
            updatedAt: true,
            updatedByUserId: true,
            adventure: { select: { id: true, name: true, rank: true } },
          },
        });
        const recordByKey = new Map(records.map((r) => [pendingAwardKey(r.scoutId, r.adventureId), r]));
        const toClear: typeof records = [];
        for (const item of adventureItems) {
          const record = recordByKey.get(pendingAwardKey(item.scoutId, item.adventureId));
          if (
            record &&
            record.completed &&
            record.awardedDate?.getTime() === awardedOn.getTime() &&
            record.updatedByUserId === session.userId &&
            record.updatedAt.getTime() === item.updatedAt.getTime() &&
            record.adventure.rank === scouts.get(record.scoutId)?.den.rank
          ) {
            toClear.push(record);
          }
        }
        if (toClear.length > 0) {
          await tx.advancementRecord.updateMany({
            where: { id: { in: toClear.map((r) => r.id) }, awardedDate: awardedOn },
            data: { awardedDate: null, updatedByUserId: session.userId },
          });
        }
        return { scouts, toClear, rankToClear };
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (error instanceof AdvancementInputError) return { ok: false, error: error.message };
    throw error;
  }

  const { scouts, toClear, rankToClear } = saved;
  const adventureById = new Map<string, { name: string }>(toClear.map((r) => [r.adventure.id, r.adventure]));
  for (const a of rankToClear) adventureById.set(rankItemId(a.rank), { name: rankBadgeName(RANK_INFO[a.rank].label) });
  const cleared: AuditedAward[] = [
    ...toClear.map((r) => ({ scoutId: r.scoutId, adventureId: r.adventureId, completedDate: r.completedDate })),
    ...rankToClear.map((a) => ({ scoutId: a.scoutId, adventureId: rankItemId(a.rank), completedDate: null })),
  ];
  const clearedScouts = await auditAwardsByScout(session, scouts, adventureById, cleared, (record) =>
    rankFromItemId(record.adventureId)
      ? { from: describeRankAward(awardedOn), to: describeRankAward(null) }
      : {
          from: describeAdventureState(true, record.completedDate, awardedOn),
          to: describeAdventureState(true, record.completedDate, null),
        },
  (list, name) =>
    `Undid the award of ${describeAwardCount(list, adventureById)} for ${name} (award date ${auditDate(awardedOn)} cleared)`,
  );

  revalidateAdvancement(scouts);
  return {
    ok: true,
    cleared: cleared.length,
    scouts: clearedScouts,
    changedSince: request.items.length - cleared.length,
    clearedKeys: cleared.map((r) => pendingAwardKey(r.scoutId, r.adventureId)),
  };
}

// ---- One scout's rank badge, from their card ----

export type SetRankAwardResult =
  | { ok: true; award: { awardedDate: string; updatedAt: string } | null }
  | { ok: false; error: string };

/**
 * Sets, changes or clears (awardedDate null) the award date of a scout's rank
 * badge — always their den's rank. A new award needs the badge earned right
 * now; any date can't be in the future or before the day it was earned. An
 * award whose badge is no longer earned (an adventure was unchecked since) can
 * still be changed or cleared — the audit page flags it until someone does.
 * Logged like every other advancement save.
 */
export async function setRankAwardAction(scoutId: string, awardedDate: string | null): Promise<SetRankAwardResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not authorized." };
  if (typeof scoutId !== "string" || !scoutId || scoutId.length > 64) {
    return { ok: false, error: "That scout couldn't be found. Reload the page and try again." };
  }
  if (awardedDate !== null) {
    const problem = awardDateProblem(awardedDate, todayDateOnlyString());
    if (problem) return { ok: false, error: problem };
  }
  const refusal = await precheckScouts(session, [scoutId]);
  if (refusal) return { ok: false, error: refusal };

  let saved;
  try {
    saved = await prisma.$transaction(async (tx) => {
      const scouts = await lockScoutsForAdvancement(tx, session, [scoutId]);
      const scout = scouts.get(scoutId)!;
      const rank = scout.den.rank as Rank;
      const badge = rankBadgeName(RANK_INFO[rank].label);
      const existing = await tx.scoutRankAward.findUnique({ where: { scoutId_rank: { scoutId, rank } } });

      if (awardedDate === null) {
        if (!existing) return { scouts, rank, badge, before: null, after: null };
        await tx.scoutRankAward.delete({ where: { id: existing.id } });
        return { scouts, rank, badge, before: existing.awardedDate, after: null };
      }

      const progress = (await rankProgressFor(tx, [{ id: scoutId, rank }])).get(scoutId)!;
      if (!existing && !progress.earned) {
        throw new AdvancementInputError(`${scout.firstName} hasn't earned the ${badge} yet — check off its adventures first.`);
      }
      if (progress.earned && progress.earnedDate && awardedDate < progress.earnedDate) {
        throw new AdvancementInputError(
          `The award date can't be before ${scout.firstName} earned the ${badge} (${auditDate(parseDateOnlyString(progress.earnedDate))}).`,
        );
      }
      const on = parseDateOnlyString(awardedDate) as Date;
      const row = await tx.scoutRankAward.upsert({
        where: { scoutId_rank: { scoutId, rank } },
        create: { scoutId, rank, awardedDate: on, updatedByUserId: session.userId },
        update: { awardedDate: on, updatedByUserId: session.userId },
      });
      return { scouts, rank, badge, before: existing?.awardedDate ?? null, after: row };
    });
  } catch (error) {
    if (error instanceof AdvancementInputError) return { ok: false, error: error.message };
    throw error;
  }

  const { scouts, badge, before, after } = saved;
  const changed = (before?.getTime() ?? null) !== (after?.awardedDate.getTime() ?? null);
  if (changed) {
    const scout = scouts.get(scoutId)!;
    const name = `${scout.firstName} ${scout.lastName}`;
    await recordAudit(session, {
      action: "advancement.update",
      summary: after
        ? before
          ? `Changed the ${badge} award date for ${name} to ${auditDate(after.awardedDate)}`
          : `Awarded the ${badge} for ${name} (award date ${auditDate(after.awardedDate)})`
        : `Cleared the ${badge} award for ${name}`,
      entityType: "Scout",
      entityId: scoutId,
      denId: scout.denId,
      details: [{ label: badge, from: describeRankAward(before), to: describeRankAward(after?.awardedDate ?? null) }],
    });
    revalidateAdvancement(scouts);
  }
  return {
    ok: true,
    award: after ? { awardedDate: awardedDate as string, updatedAt: after.updatedAt.toISOString() } : null,
  };
}

/**
 * One "advancement.update" audit entry per scout — the same shape Apply
 * Changes writes, so the audit page's History and the Audit Log's Main tab
 * show a bulk award exactly like one typed on the card. Returns how many
 * scouts got an entry.
 */
type AuditedAward = { scoutId: string; adventureId: string; completedDate: Date | null };

/** The rank badge's state in the audit log's from → to. */
function describeRankAward(awardedDate: Date | null): string {
  return awardedDate ? `Awarded ${auditDate(awardedDate)}` : EMPTY;
}

/** "3 adventures", "the Wolf rank badge", "2 adventures and the Wolf rank badge". */
function describeAwardCount(list: readonly AuditedAward[], names: Map<string, { name: string }>): string {
  const adventures = list.filter((r) => !rankFromItemId(r.adventureId)).length;
  const badges = list.filter((r) => rankFromItemId(r.adventureId)).map((r) => `the ${names.get(r.adventureId)?.name ?? "rank badge"}`);
  const parts = adventures ? [adventures === 1 ? "1 adventure" : `${adventures} adventures`] : [];
  return [...parts, ...badges].join(" and ");
}

async function auditAwardsByScout<R extends AuditedAward>(
  session: SessionPayload,
  scouts: Map<string, LockedScout>,
  adventureById: Map<string, { name: string }>,
  records: R[],
  describe: (record: R) => { from: string; to: string },
  summary: (list: R[], scoutName: string) => string,
) {
  const byScout = new Map<string, R[]>();
  for (const record of records) byScout.set(record.scoutId, [...(byScout.get(record.scoutId) ?? []), record]);
  for (const [scoutId, list] of byScout) {
    const scout = scouts.get(scoutId)!;
    const details: AuditDetail[] = list.map((record) => ({
      label: adventureById.get(record.adventureId)?.name ?? record.adventureId,
      ...describe(record),
    }));
    await recordAudit(session, {
      action: "advancement.update",
      summary: summary(list, `${scout.firstName} ${scout.lastName}`),
      entityType: "Scout",
      entityId: scoutId,
      denId: scout.denId,
      details,
    });
  }
  return byScout.size;
}

function revalidateAdvancement(scouts: Map<string, LockedScout>) {
  revalidatePath("/portal/den");
  revalidatePath("/portal/parent");
  revalidatePath("/portal/roster");
  revalidatePath("/portal/awards");
  revalidatePath("/portal/audits/advancement");
  for (const denId of new Set([...scouts.values()].map((s) => s.denId))) revalidatePath(`/portal/admin/dens/${denId}`);
}
