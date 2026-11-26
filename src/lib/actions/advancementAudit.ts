"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAdvancementAuditEditor } from "@/lib/authorize";
import { recordAudit } from "@/lib/audit";
import { toDateOnlyString, todayDateOnly } from "@/lib/dateOnly";
import {
  MAX_AUDIT_NOTE_LENGTH,
  auditRank,
  auditRecord,
  lastEdited,
  rankBadgeName,
  rankLastEdited,
} from "@/lib/advancementAuditRules";
import { rankProgressFor } from "@/lib/rankStatus";
import { RANK_INFO } from "@/lib/rankConfig";
import { loadRequirementAuditInputs, requirementAuditInputFor } from "@/lib/advancementAuditData";

/*
 * Bulk and single-row actions on Audits -> Advancement. One form posts the
 * ticked record ids, the note and which button was pressed:
 *
 * - flag: "Flag for correction" — asks the den leader to fix the record.
 * - resolve: "Mark resolved" — accepts a flagged record's dates as they are.
 *   Only records that fail a check take it; the rest are skipped.
 * - clear: removes whatever mark is on the record.
 *
 * A mark never changes the advancement record itself — the den leader fixes
 * dates on the den page as usual, which also makes a "needs correction" mark
 * stop counting (see activeMark in advancementAuditRules.ts).
 */

const PAGE_PATH = "/portal/audits/advancement";
const MAX_RECORDS = 200;

const INTENTS = ["flag", "resolve", "clear"] as const;
type Intent = (typeof INTENTS)[number];

/** Back to the page and filters the form was posted from — never anywhere else. */
function backTo(raw: FormDataEntryValue | null, result: Record<string, string>) {
  const query = new URLSearchParams(typeof raw === "string" && raw.length <= 1000 ? raw : "");
  for (const key of ["done", "n", "skipped", "error"]) query.delete(key);
  for (const [key, value] of Object.entries(result)) query.set(key, value);
  redirect(`${PAGE_PATH}?${query.toString()}`);
}

export async function advancementAuditAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session || !isAdvancementAuditEditor(session)) backTo(formData.get("back"), { error: "denied" });
  const actor = session!;

  const intent = formData.get("intent");
  if (typeof intent !== "string" || !(INTENTS as readonly string[]).includes(intent)) {
    return backTo(formData.get("back"), { error: "intent" });
  }

  const ids = Array.from(
    new Set(formData.getAll("recordId").filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 64)),
  );
  if (ids.length === 0) return backTo(formData.get("back"), { error: "none" });
  if (ids.length > MAX_RECORDS) return backTo(formData.get("back"), { error: "toomany" });

  const rawNote = formData.get("note");
  const note = typeof rawNote === "string" ? rawNote.trim().slice(0, MAX_AUDIT_NOTE_LENGTH) : "";
  if (intent !== "clear" && !note) return backTo(formData.get("back"), { error: "note" });

  const done = await applyMarks(actor, intent as Intent, ids, note);
  revalidatePath(PAGE_PATH);
  backTo(formData.get("back"), { done: intent, n: String(done.applied), skipped: String(done.skipped) });
}

async function applyMarks(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  intent: Intent,
  ids: string[],
  note: string,
) {
  const today = todayDateOnly();
  // A rank badge's row is "rank:<ScoutRankAward id>"; one not yet awarded has nothing to mark.
  const rankAwardIds = ids.filter((id) => id.startsWith("rank:")).map((id) => id.slice("rank:".length));
  const recordIds = ids.filter((id) => !id.startsWith("rank:") && !id.startsWith("rank-pending:"));
  let applied = await applyRankMarks(session, intent, rankAwardIds, note, today);

  const records = await prisma.advancementRecord.findMany({
    where: { id: { in: recordIds }, scout: { active: true } },
    include: {
      adventure: { select: { name: true, rank: true } },
      scout: { select: { firstName: true, lastName: true, denId: true, den: { select: { scoutingYear: true, rank: true } } } },
      auditMark: true,
    },
  });

  const requirementInputs = await loadRequirementAuditInputs(
    records.map((r) => ({ scoutId: r.scoutId, adventureId: r.adventureId })),
  );

  for (const record of records) {
    const requirements = requirementAuditInputFor(requirementInputs, record.scoutId, record.adventureId);
    // Pinned to the latest edit of the adventure or its requirement checks, as the page judges it.
    const updatedAt = lastEdited(record.updatedAt, requirements);
    const scoutName = `${record.scout.firstName} ${record.scout.lastName}`.trim();
    const what = `“${record.adventure.name}” for ${scoutName}`;

    if (intent === "clear") {
      if (!record.auditMark) continue;
      await prisma.advancementAuditMark.delete({ where: { recordId: record.id } });
      await recordAudit(session, {
        action: "advancement.audit.clear",
        summary: `Cleared the audit mark on ${what}`,
        entityType: "AdvancementRecord",
        entityId: record.id,
        denId: record.scout.denId,
      });
      applied += 1;
      continue;
    }

    if (intent === "resolve") {
      // Resolving is for a record that fails a check; judged without any
      // existing mark, so a "needs correction" record can be resolved too.
      const result = auditRecord(
        {
          completed: record.completed,
          completedDate: record.completedDate,
          awardedDate: record.awardedDate,
          updatedAt,
          scoutingYear: record.scout.den.scoutingYear,
          mark: null,
          requirements,
        },
        today,
      );
      if (!result || result.discrepancies.length === 0) continue;
    }

    const kind = intent === "flag" ? "NEEDS_CORRECTION" : "RESOLVED";
    const data = { kind, note, recordUpdatedAt: updatedAt, markedByUserId: session.userId, createdAt: new Date() } as const;
    await prisma.advancementAuditMark.upsert({
      where: { recordId: record.id },
      create: { recordId: record.id, ...data },
      update: data,
    });
    await recordAudit(session, {
      action: intent === "flag" ? "advancement.audit.flag" : "advancement.audit.resolve",
      summary: `${intent === "flag" ? "Flagged for correction" : "Marked resolved"}: ${what} — “${note}”`,
      entityType: "AdvancementRecord",
      entityId: record.id,
      denId: record.scout.denId,
    });
    applied += 1;
  }

  return { applied, skipped: ids.length - applied };
}

/** The same three marks on rank badges, pinned to the badge's last edit (rankLastEdited). */
async function applyRankMarks(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  intent: Intent,
  awardIds: string[],
  note: string,
  today: Date,
) {
  if (awardIds.length === 0) return 0;
  const awards = await prisma.scoutRankAward.findMany({
    where: { id: { in: awardIds }, scout: { active: true } },
    include: {
      scout: { select: { firstName: true, lastName: true, denId: true, den: { select: { rank: true } } } },
      auditMark: true,
    },
  });
  // Only the scout's current den rank shows on the page.
  const current = awards.filter((a) => a.rank === a.scout.den.rank);
  const scoutIds = [...new Set(current.map((a) => a.scoutId))];
  const [progress, records] = await Promise.all([
    rankProgressFor(prisma, current.map((a) => ({ id: a.scoutId, rank: a.rank }))),
    prisma.advancementRecord.findMany({
      where: { scoutId: { in: scoutIds } },
      select: { scoutId: true, updatedAt: true, adventure: { select: { rank: true } } },
    }),
  ]);

  let applied = 0;
  for (const award of current) {
    const updatedAt = rankLastEdited(
      award.updatedAt,
      records.filter((r) => r.scoutId === award.scoutId && r.adventure.rank === award.rank),
    );
    const scoutName = `${award.scout.firstName} ${award.scout.lastName}`.trim();
    const what = `the ${rankBadgeName(RANK_INFO[award.rank].label)} for ${scoutName}`;

    if (intent === "clear") {
      if (!award.auditMark) continue;
      await prisma.advancementAuditMark.delete({ where: { rankAwardId: award.id } });
      await recordAudit(session, {
        action: "advancement.audit.clear",
        summary: `Cleared the audit mark on ${what}`,
        entityType: "ScoutRankAward",
        entityId: award.id,
        denId: award.scout.denId,
      });
      applied += 1;
      continue;
    }

    if (intent === "resolve") {
      const p = progress.get(award.scoutId)!;
      const result = auditRank(
        {
          earned: p.earned,
          earnedDate: p.earnedDate,
          awardedDate: toDateOnlyString(award.awardedDate),
          updatedAt,
          mark: null,
        },
        toDateOnlyString(today),
      );
      if (!result || result.discrepancies.length === 0) continue;
    }

    const kind = intent === "flag" ? "NEEDS_CORRECTION" : "RESOLVED";
    const data = { kind, note, recordUpdatedAt: updatedAt, markedByUserId: session.userId, createdAt: new Date() } as const;
    await prisma.advancementAuditMark.upsert({
      where: { rankAwardId: award.id },
      create: { rankAwardId: award.id, ...data },
      update: data,
    });
    await recordAudit(session, {
      action: intent === "flag" ? "advancement.audit.flag" : "advancement.audit.resolve",
      summary: `${intent === "flag" ? "Flagged for correction" : "Marked resolved"}: ${what} — “${note}”`,
      entityType: "ScoutRankAward",
      entityId: award.id,
      denId: award.scout.denId,
    });
    applied += 1;
  }
  return applied;
}
