"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertLedgerAccess } from "@/lib/authorize";
import { auditMoney, auditDate } from "@/lib/audit";
import { recordLedgerAudit } from "@/lib/ledgerAudit";
import { textField } from "@/lib/formValues";
import { readDateOnlyField, todayDateOnly, toDateOnlyString } from "@/lib/dateOnly";
import { isSheetsConfigured } from "@/lib/googleSheetsConfig";
import { parseCsv } from "@/lib/csvParse";
import {
  defaultCutoverDate,
  guessLedgerCategoryKind,
  parseLedgerGrid,
  type LedgerImportCell,
  type LedgerImportParse,
} from "@/lib/ledgerImport";
import { requestLedgerSync } from "@/lib/ledgerSyncTrigger";
import type { LedgerCategoryKind } from "@/generated/prisma/enums";

/*
 * The Ledger's one-time import of the treasurer's Google Sheet tab — its own
 * "use server" file (every export is a public endpoint), with the parsing in
 * src/lib/ledgerImport.ts. Only the ledger accounts can run any of it.
 *
 * Preview reads the tab (through the Sheets API, or a CSV saved from it) and
 * shows what would be imported. Confirm reads the SAME source again — the
 * Sheet, or the file sent again with the confirm form — and parses it again,
 * so nothing the browser sends back can skip a check; it's refused if the
 * rows differ from the preview's (the fingerprint). Then everything lands in
 * one transaction: the categories, the batch, its lines, the cutover date and
 * the audit entry. Google is never waited on inside a transaction.
 *
 * Only one import can be in the ledger at a time; Undo marks its lines
 * deleted so it can be done again.
 */

export type LedgerImportSource = { kind: "sheet"; tab: string } | { kind: "csv"; fileName: string };

/** One Sheet category and where it goes by default: an existing category's id, or "new". */
export type LedgerImportMapping = {
  key: string;
  name: string;
  count: number;
  netCents: number;
  target: string;
  kind: LedgerCategoryKind;
};

export type LedgerImportPreview = {
  source: LedgerImportSource;
  parse: LedgerImportParse;
  mappings: LedgerImportMapping[];
  /** YYYY-MM-DD; the day after the last imported line. */
  defaultCutover: string | null;
  /** The latest cutover the form accepts (YYYY-MM-DD). */
  latestCutover: string;
  /** Lines typed into the portal dated on or before the last imported line — they may be in the Sheet too. */
  overlappingPortalLines: number;
};

export type LedgerImportPreviewResult = { error?: string; preview?: LedgerImportPreview };
export type LedgerImportConfirmResult = { error?: string; stale?: boolean };

/** Bigger than any ledger tab saved as CSV. */
const MAX_CSV_BYTES = 512 * 1024;
/** How far ahead the cutover may be set. */
const CUTOVER_MAX_DAYS_AHEAD = 30;
const DAY_MS = 86_400_000;
const LEDGER_PATH = "/portal/admin/ledger";
const UNDO_FIRST = "There's already an import in the ledger. Undo the earlier import first (Import History, below).";

/** A refusal the person can act on; turned into { error } for the form. */
class ImportInputError extends Error {
  constructor(
    message: string,
    readonly stale = false,
  ) {
    super(message);
  }
}

async function ledgerSession() {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  await assertLedgerAccess(session);
  return session;
}

// ---------- Reading the source ----------

async function readSource(formData: FormData): Promise<{ source: LedgerImportSource; grid: LedgerImportCell[][] }> {
  const kind = textField(formData.get("source"));

  if (kind === "csv") {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ImportInputError("Choose the CSV file first.");
    if (file.size > MAX_CSV_BYTES) throw new ImportInputError("That file is too large to be the ledger tab (the limit is 512 KB).");
    const parsed = parseCsv(await file.text());
    if (!parsed.ok) throw new ImportInputError(`That file couldn't be read as a CSV: ${parsed.error}`);
    const fileName = (file.name || "upload.csv").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120);
    return { source: { kind: "csv", fileName }, grid: parsed.rows };
  }

  if (kind === "sheet") {
    if (!isSheetsConfigured()) {
      throw new ImportInputError("The Google Sheet connection isn't set up here. Upload the tab as a CSV file instead.");
    }
    const tab = textField(formData.get("tab"));
    if (!tab || tab.length > 200) throw new ImportInputError("Choose the tab to import.");
    const { listTabs, readTabValues, isPortalTab, PORTAL_TAB_TITLE, SheetsError, SHEETS_DEADLINE_MS } = await import(
      "@/lib/googleSheets"
    );
    // One deadline for both requests.
    const signal = AbortSignal.timeout(SHEETS_DEADLINE_MS);
    try {
      const found = (await listTabs({ signal })).find((t) => t.title === tab);
      if (!found) throw new ImportInputError("That tab isn't in the Sheet any more. Reload the page and pick it again.", true);
      if (isPortalTab(found) || found.title.trim().toLowerCase() === PORTAL_TAB_TITLE.toLowerCase()) {
        throw new ImportInputError("That's the portal's own copy of the ledger. Pick the treasurer's tab.");
      }
      const grid = await readTabValues(tab, { signal });
      return { source: { kind: "sheet", tab }, grid };
    } catch (error) {
      if (error instanceof ImportInputError) throw error;
      if (error instanceof SheetsError) throw new ImportInputError(error.message);
      console.error(`[ledger-import] Sheet read failed: ${(error as Error)?.name ?? "error"}`);
      throw new ImportInputError("Couldn't read the Sheet. Try again, or upload the tab as a CSV file instead.");
    }
  }

  throw new ImportInputError("Choose the Sheet tab or a CSV file to import.");
}

function latestCutover(): string {
  return toDateOnlyString(new Date(todayDateOnly().getTime() + CUTOVER_MAX_DAYS_AHEAD * DAY_MS));
}

// ---------- Preview ----------

/** Reads the tab and returns what would be imported. Saves nothing. */
export async function previewLedgerImportAction(formData: FormData): Promise<LedgerImportPreviewResult> {
  await ledgerSession();
  try {
    if (await prisma.ledgerImportBatch.findFirst({ where: { undoneAt: null }, select: { id: true } })) {
      throw new ImportInputError(UNDO_FIRST);
    }
    const { source, grid } = await readSource(formData);
    const parse = parseLedgerGrid(grid, { today: todayDateOnly() });

    const [existing, events, trips, overlapping] = await Promise.all([
      prisma.ledgerCategory.findMany({ select: { id: true, nameKey: true } }),
      prisma.event.findMany({ select: { title: true } }),
      prisma.tripPage.findMany({ select: { title: true } }),
      parse.totals.lastDate
        ? prisma.ledgerEntry.count({
            where: {
              deletedAt: null,
              origin: { not: "IMPORTED" },
              entryDate: { lte: new Date(`${parse.totals.lastDate}T00:00:00.000Z`) },
            },
          })
        : Promise.resolve(0),
    ]);
    const byKey = new Map(existing.map((c) => [c.nameKey, c.id]));
    const titles = [...events, ...trips].map((t) => t.title);

    return {
      preview: {
        source,
        parse,
        mappings: parse.categories.map((category) => ({
          key: category.key,
          name: category.name,
          count: category.count,
          netCents: category.netCents,
          target: byKey.get(category.key) ?? "new",
          kind: guessLedgerCategoryKind(category.name, titles),
        })),
        defaultCutover: defaultCutoverDate(parse.totals.lastDate),
        latestCutover: latestCutover(),
        overlappingPortalLines: overlapping,
      },
    };
  } catch (error) {
    if (error instanceof ImportInputError) return { error: error.message };
    throw error;
  }
}

// ---------- Confirm ----------

type Target = { kind: "existing"; id: string } | { kind: "new"; categoryKind: LedgerCategoryKind };

/**
 * Imports the tab. The form sends back the source (the tab's name, or the
 * same file), the preview's fingerprint, where each Sheet category goes
 * (`target:<key>` = a category id or "new", `kind:<key>` = FUND or EVENT),
 * the transfer pairs to link (`pair`) and the cutover date.
 */
export async function confirmLedgerImportAction(formData: FormData): Promise<LedgerImportConfirmResult> {
  const session = await ledgerSession();
  try {
    // Checked again under the lock below; this only saves a trip to Google.
    if (await prisma.ledgerImportBatch.findFirst({ where: { undoneAt: null }, select: { id: true } })) {
      throw new ImportInputError(UNDO_FIRST, true);
    }
    const { source, grid } = await readSource(formData);
    const parse = parseLedgerGrid(grid, { today: todayDateOnly() });
    const changed =
      source.kind === "sheet"
        ? "The Sheet changed since the preview. Preview it again to see the latest rows."
        : "The file isn't the one that was previewed. Preview it again.";
    if (textField(formData.get("fingerprint")) !== parse.fingerprint) throw new ImportInputError(changed, true);
    if (parse.errors.length > 0) throw new ImportInputError("Some rows need fixing in the Sheet first. Preview it again.", true);
    if (parse.rows.length === 0) throw new ImportInputError("There are no lines to import.");

    // Where each Sheet category goes.
    const targets = new Map<string, Target>();
    for (const category of parse.categories) {
      const target = textField(formData.get(`target:${category.key}`));
      if (!target) throw new ImportInputError(`Choose where the Sheet's “${category.name}” lines go.`);
      if (target === "new") {
        const kind = textField(formData.get(`kind:${category.key}`)) || "FUND";
        if (kind !== "FUND" && kind !== "EVENT") throw new ImportInputError(`Choose Fund or Event for “${category.name}”.`);
        targets.set(category.key, { kind: "new", categoryKind: kind });
      } else {
        if (target.length > 100) throw new ImportInputError("That category no longer exists. Reload the page.", true);
        targets.set(category.key, { kind: "existing", id: target });
      }
    }

    // Moves between categories to link: only pairs the parser itself found.
    const offered = new Map(parse.transferPairs.map((pair) => [pair.id, pair]));
    const linked = [...new Set(formData.getAll("pair").map((value) => textField(value)))].filter(Boolean);
    for (const id of linked) {
      if (!offered.has(id)) throw new ImportInputError("The linked moves don't match the preview. Preview it again.", true);
    }
    const transferOf = new Map<number, string>();
    for (const id of linked) {
      const pair = offered.get(id)!;
      const transferId = randomUUID();
      transferOf.set(pair.outRow, transferId);
      transferOf.set(pair.inRow, transferId);
    }

    // The cutover: after the last imported line, and not far in the future.
    const lastDate = parse.totals.lastDate!;
    const cutoverField = readDateOnlyField(formData.get("cutoverDate"), "The cutover date");
    if (cutoverField.error !== undefined) throw new ImportInputError(cutoverField.error);
    const cutoverIso = cutoverField.date ? toDateOnlyString(cutoverField.date) : defaultCutoverDate(lastDate)!;
    if (cutoverIso <= lastDate) {
      throw new ImportInputError("The cutover date has to be after the last imported line's date.");
    }
    if (cutoverIso > latestCutover()) {
      throw new ImportInputError(`The cutover date can be at most ${CUTOVER_MAX_DAYS_AHEAD} days from today.`);
    }
    const cutoverDate = new Date(`${cutoverIso}T00:00:00.000Z`);

    await prisma.$transaction(
      async (tx) => {
        // Two confirms at once: the second waits here, then sees the first's batch.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ledger-import'))`;
        if (await tx.ledgerImportBatch.findFirst({ where: { undoneAt: null }, select: { id: true } })) {
          throw new ImportInputError(UNDO_FIRST, true);
        }

        // Categories: existing ones must still be there; new ones must not clash with one.
        const categoryIds = new Map<string, string>();
        const created: string[] = [];
        const last = await tx.ledgerCategory.aggregate({ _max: { sortOrder: true } });
        let sortOrder = last._max.sortOrder ?? 0;
        for (const category of parse.categories) {
          const target = targets.get(category.key)!;
          if (target.kind === "existing") {
            const found = await tx.ledgerCategory.findUnique({ where: { id: target.id }, select: { id: true } });
            if (!found) throw new ImportInputError("A category picked for the import no longer exists. Reload the page.", true);
            categoryIds.set(category.key, found.id);
          } else {
            const clash = await tx.ledgerCategory.findUnique({ where: { nameKey: category.key }, select: { name: true } });
            if (clash) {
              throw new ImportInputError(`A category named “${clash.name}” already exists. Pick it for the Sheet's “${category.name}” lines.`);
            }
            sortOrder = Math.min(sortOrder + 10, 10_000);
            const row = await tx.ledgerCategory.create({
              data: { name: category.name, nameKey: category.key, kind: target.categoryKind, sortOrder },
              select: { id: true },
            });
            categoryIds.set(category.key, row.id);
            created.push(`${category.name} (${target.categoryKind === "EVENT" ? "Event" : "Fund"})`);
          }
        }
        for (const id of linked) {
          const pair = offered.get(id)!;
          const fromRow = parse.rows.find((r) => r.sheetRow === pair.outRow)!;
          const toRow = parse.rows.find((r) => r.sheetRow === pair.inRow)!;
          if (categoryIds.get(fromRow.categoryKey) === categoryIds.get(toRow.categoryKey)) {
            throw new ImportInputError(
              `Rows ${pair.outRow} and ${pair.inRow} would both go into the same category, so they can't be linked as a move.`,
            );
          }
        }

        const batch = await tx.ledgerImportBatch.create({
          data: {
            fingerprint: parse.fingerprint,
            sourceLabel: source.kind === "sheet" ? `Sheet tab “${source.tab}”` : `CSV file “${source.fileName}”`,
            rowCount: parse.rows.length,
            inflowCents: parse.totals.inflowCents,
            outflowCents: parse.totals.outflowCents,
            importedByName: session.displayName,
          },
          select: { id: true, sourceLabel: true },
        });
        await tx.ledgerEntry.createMany({
          data: parse.rows.map((row) => ({
            entryDate: new Date(`${row.date}T00:00:00.000Z`),
            description: row.description,
            categoryId: categoryIds.get(row.categoryKey)!,
            direction: row.direction,
            amountCents: row.cents,
            origin: "IMPORTED" as const,
            transferId: transferOf.get(row.sheetRow) ?? null,
            importBatchId: batch.id,
            importRowNumber: row.sheetRow,
            createdByUserId: session.userId,
            createdByName: session.displayName,
          })),
        });

        const before = await tx.ledgerSettings.findUnique({ where: { id: "main" }, select: { cutoverDate: true } });
        await tx.ledgerSettings.upsert({
          where: { id: "main" },
          create: { id: "main", cutoverDate },
          update: { cutoverDate },
        });

        await recordLedgerAudit(tx, session, {
          action: "ledger.import",
          summary: `Imported ${parse.rows.length} ledger lines from the ${batch.sourceLabel} (in ${auditMoney(parse.totals.inflowCents)}, out ${auditMoney(parse.totals.outflowCents)}); the portal takes over on ${auditDate(cutoverDate)}`,
          entityType: "LedgerImportBatch",
          entityId: batch.id,
          details: [
            { label: "Source", from: "—", to: batch.sourceLabel },
            { label: "Lines", from: "—", to: String(parse.rows.length) },
            { label: "Dates", from: "—", to: `${auditDate(new Date(`${parse.totals.firstDate}T00:00:00.000Z`))} – ${auditDate(new Date(`${lastDate}T00:00:00.000Z`))}` },
            { label: "Money in", from: "—", to: auditMoney(parse.totals.inflowCents) },
            { label: "Money out", from: "—", to: auditMoney(parse.totals.outflowCents) },
            { label: "New categories", from: "—", to: created.length > 0 ? created.join(", ").slice(0, 500) : "None" },
            { label: "Linked moves", from: "—", to: String(linked.length) },
            { label: "Cutover date", from: auditDate(before?.cutoverDate), to: auditDate(cutoverDate) },
          ],
        });
      },
      // A few hundred lines in one insert, plus the categories; well inside this.
      { timeout: 30_000, maxWait: 10_000 },
    );
    revalidatePath(LEDGER_PATH, "layout");
    requestLedgerSync();
    return {};
  } catch (error) {
    if (error instanceof ImportInputError) return error.stale ? { error: error.message, stale: true } : { error: error.message };
    throw error;
  }
}

// ---------- Undo ----------

/**
 * Takes an import back out: its lines are marked deleted (kept, as every
 * ledger line is), the batch is marked undone and the cutover date is
 * cleared, so the tab can be imported again. A second click does nothing.
 */
export async function undoLedgerImportAction(formData: FormData): Promise<void> {
  const session = await ledgerSession();
  const id = textField(formData.get("id"));
  if (!id) throw new Error("Missing import id.");

  const changed = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ledger-import'))`;
    const batch = await tx.ledgerImportBatch.findUnique({ where: { id } });
    if (!batch || batch.undoneAt) return false;
    const now = new Date();
    const { count } = await tx.ledgerEntry.updateMany({
      where: { importBatchId: id, deletedAt: null },
      data: { deletedAt: now, deletedByName: session.displayName },
    });
    await tx.ledgerImportBatch.update({ where: { id }, data: { undoneAt: now, undoneByName: session.displayName } });
    const before = await tx.ledgerSettings.findUnique({ where: { id: "main" }, select: { cutoverDate: true } });
    if (before?.cutoverDate) await tx.ledgerSettings.update({ where: { id: "main" }, data: { cutoverDate: null } });

    await recordLedgerAudit(tx, session, {
      action: "ledger.import.undo",
      summary: `Undid the ledger import from the ${batch.sourceLabel} — ${count} ${count === 1 ? "line" : "lines"} came off the ledger`,
      entityType: "LedgerImportBatch",
      entityId: id,
      details: [
        { label: "Source", from: batch.sourceLabel, to: "—" },
        { label: "Lines in the ledger", from: String(count), to: "0" },
        { label: "Cutover date", from: auditDate(before?.cutoverDate), to: "—" },
      ],
    });
    return true;
  });
  if (changed) {
    revalidatePath(LEDGER_PATH, "layout");
    requestLedgerSync();
  }
}
