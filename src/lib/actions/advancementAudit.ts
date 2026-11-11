"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAdvancementAuditEditor } from "@/lib/authorize";
import { recordAudit } from "@/lib/audit";
import { todayDateOnly } from "@/lib/dateOnly";
import { MAX_AUDIT_NOTE_LENGTH, auditRecord } from "@/lib/advancementAuditRules";

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
  const records = await prisma.advancementRecord.findMany({
    where: { id: { in: ids }, scout: { active: true } },
    include: {
      adventure: { select: { name: true, rank: true } },
      scout: { select: { firstName: true, lastName: true, denId: true, den: { select: { scoutingYear: true, rank: true } } } },
      auditMark: true,
    },
  });

  let applied = 0;
  for (const record of records) {
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
          updatedAt: record.updatedAt,
          scoutingYear: record.scout.den.scoutingYear,
          mark: null,
        },
        today,
      );
      if (!result || result.discrepancies.length === 0) continue;
    }

    const kind = intent === "flag" ? "NEEDS_CORRECTION" : "RESOLVED";
    const data = { kind, note, recordUpdatedAt: record.updatedAt, markedByUserId: session.userId, createdAt: new Date() } as const;
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
