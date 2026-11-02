"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertLedgerAccess } from "@/lib/authorize";
import { changedFields, auditMoney, auditDate } from "@/lib/audit";
import { recordLedgerAudit } from "@/lib/ledgerAudit";
import { dollarsToCents, hasControlCharacters, MAX_NOTE_LENGTH, textField } from "@/lib/formValues";
import { readDateOnlyField, todayDateOnly } from "@/lib/dateOnly";
import { ledgerCategoryNameKey } from "@/lib/ledgerMath";
import { requestLedgerSync } from "@/lib/ledgerSyncTrigger";
import type { Prisma } from "@/generated/prisma/client";
import type { LedgerCategoryKind, LedgerDirection } from "@/generated/prisma/enums";

/*
 * The Ledger's Server Actions — only the ledger accounts
 * (LEDGER_USERNAMES) can run any of them. A "use server" file makes every
 * export a public endpoint, so this file exports actions and nothing else:
 * the loaders are in src/lib/ledgerData.ts and the Sheet sync in its own
 * module.
 *
 * Every action: getSession → assertLedgerAccess → check the input → one
 * transaction holding the change and its audit entry → revalidate → ask for
 * a Sheet sync. Lines are never deleted, only marked deleted (and can be
 * restored), so the books keep their history.
 *
 * Form actions return { error } for something the treasurer can fix (and
 * `stale` when the page was out of date), which TripAdminForm / EditPopover /
 * ActionForm show above the fields. The access check throws instead: a
 * legitimate user never hits it from the page.
 */

type LedgerFormResult = { error?: string; stale?: boolean };

/** A refusal the person can act on; turned into { error } by formResult. */
class LedgerInputError extends Error {
  constructor(
    message: string,
    readonly stale = false,
  ) {
    super(message);
  }
}

const OUT_OF_DATE = "This line changed since the page loaded. Reload the page, then make your change again.";
const LINE_GONE = "That line was deleted or no longer exists. Reload the page.";
const CATEGORY_GONE = "That category no longer exists. Reload the page and pick another.";
const CATEGORY_TAKEN = "A category with that name already exists.";

const MAX_DESCRIPTION_LENGTH = 200;
const MAX_CATEGORY_NAME_LENGTH = 60;
const MAX_SORT_ORDER = 10_000;
/** No line before this: anything earlier is a mistyped year. */
const EARLIEST_DATE = new Date("2000-01-01T00:00:00.000Z");

const LEDGER_PATH = "/portal/admin/ledger";

async function ledgerSession() {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  await assertLedgerAccess(session);
  return session;
}

async function formResult(work: () => Promise<void>): Promise<LedgerFormResult> {
  try {
    await work();
    return {};
  } catch (error) {
    if (error instanceof LedgerInputError) return error.stale ? { error: error.message, stale: true } : { error: error.message };
    throw error;
  }
}

/** After a change commits: every ledger page shows it, and the Sheet copy is asked to catch up. */
function afterLedgerChange() {
  revalidatePath(LEDGER_PATH, "layout");
  requestLedgerSync();
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

const directionLabel = (direction: LedgerDirection) => (direction === "IN" ? "In" : "Out");
const kindLabel = (kind: LedgerCategoryKind) => (kind === "EVENT" ? "Event" : "Fund");

// ---------- Field checks ----------

function readDescription(raw: FormDataEntryValue | null): string {
  const description = textField(raw);
  if (!description) throw new LedgerInputError("Describe what the money was for.");
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new LedgerInputError(`Descriptions can be at most ${MAX_DESCRIPTION_LENGTH} characters.`);
  }
  if (hasControlCharacters(description)) throw new LedgerInputError("The description has a character that can't be saved.");
  return description;
}

function readAmount(raw: FormDataEntryValue | null): number {
  const cents = dollarsToCents(textField(raw));
  if (cents === null || cents <= 0) {
    throw new LedgerInputError("Enter an amount greater than $0 (up to $1,000,000), like 45.50.");
  }
  return cents;
}

function readEntryDate(raw: FormDataEntryValue | null): Date {
  const field = readDateOnlyField(raw, "The date");
  if (field.error !== undefined) throw new LedgerInputError(field.error);
  if (!field.date) throw new LedgerInputError("Enter the date.");
  if (field.date < EARLIEST_DATE) throw new LedgerInputError("That date is before 2000 — check the year.");
  if (field.date > todayDateOnly()) throw new LedgerInputError("The date can't be in the future — check the year.");
  return field.date;
}

function readDirection(raw: FormDataEntryValue | null): LedgerDirection {
  const value = textField(raw);
  if (value !== "IN" && value !== "OUT") throw new LedgerInputError("Choose whether the money came in or went out.");
  return value;
}

/** Optional; line breaks kept (sent as CRLF, stored as LF), other control characters refused. */
function readNote(raw: FormDataEntryValue | null): string | null {
  const note = (typeof raw === "string" ? raw : "").replace(/\r\n?/g, "\n").trim();
  if (!note) return null;
  if (note.length > MAX_NOTE_LENGTH) throw new LedgerInputError(`Notes can be at most ${MAX_NOTE_LENGTH} characters.`);
  if (/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(note)) throw new LedgerInputError("The note has a character that can't be saved.");
  return note;
}

function readCategoryName(raw: FormDataEntryValue | null): string {
  const name = textField(raw).replace(/\s+/g, " ");
  if (!name) throw new LedgerInputError("Give the category a name.");
  if (name.length > MAX_CATEGORY_NAME_LENGTH) {
    throw new LedgerInputError(`Category names can be at most ${MAX_CATEGORY_NAME_LENGTH} characters.`);
  }
  if (hasControlCharacters(name)) throw new LedgerInputError("The name has a character that can't be saved.");
  return name;
}

function readKind(raw: FormDataEntryValue | null): LedgerCategoryKind {
  const value = textField(raw) || "FUND";
  if (value !== "FUND" && value !== "EVENT") throw new LedgerInputError("Choose Fund or Event.");
  return value;
}

/** Blank means `fallback`. */
function readSortOrder(raw: FormDataEntryValue | null, fallback: number): number {
  const value = textField(raw);
  if (!value) return fallback;
  if (!/^-?\d{1,5}$/.test(value) || Math.abs(Number(value)) > MAX_SORT_ORDER) {
    throw new LedgerInputError(`The order has to be a whole number from -${MAX_SORT_ORDER} to ${MAX_SORT_ORDER}.`);
  }
  return Number(value);
}

function readId(raw: FormDataEntryValue | null, what: string): string {
  const id = textField(raw);
  if (!id || id.length > 100) throw new LedgerInputError(`Missing ${what}. Reload the page.`, true);
  return id;
}

/**
 * The category a line is going into. Archived ones are refused unless the
 * line is already in it (an edit that leaves the category alone).
 */
async function usableCategory(tx: Prisma.TransactionClient, categoryId: string, currentCategoryId?: string) {
  const category = await tx.ledgerCategory.findUnique({ where: { id: categoryId } });
  if (!category) throw new LedgerInputError(CATEGORY_GONE, true);
  if (category.archived && category.id !== currentCategoryId) {
    throw new LedgerInputError(`“${category.name}” is archived. Pick another category, or un-archive it first.`);
  }
  return category;
}

// ---------- Lines ----------

export async function addLedgerEntryAction(formData: FormData): Promise<LedgerFormResult> {
  const session = await ledgerSession();
  return formResult(async () => {
    const entryDate = readEntryDate(formData.get("entryDate"));
    const description = readDescription(formData.get("description"));
    const categoryId = readId(formData.get("categoryId"), "category");
    const direction = readDirection(formData.get("direction"));
    const amountCents = readAmount(formData.get("amount"));
    const note = readNote(formData.get("note"));

    await prisma.$transaction(async (tx) => {
      const category = await usableCategory(tx, categoryId);
      const entry = await tx.ledgerEntry.create({
        data: {
          entryDate,
          description,
          categoryId,
          direction,
          amountCents,
          note,
          origin: "MANUAL",
          createdByUserId: session.userId,
          createdByName: session.displayName,
        },
      });
      await recordLedgerAudit(tx, session, {
        action: "ledger.entry.add",
        summary: `Added a ${auditMoney(amountCents)} ledger line “${description}” (money ${direction === "IN" ? "in" : "out"}, ${category.name})`,
        entityType: "LedgerEntry",
        entityId: entry.id,
        details: [
          { label: "Date", from: "—", to: auditDate(entryDate) },
          { label: "Description", from: "—", to: description },
          { label: "Category", from: "—", to: category.name },
          { label: "In / Out", from: "—", to: directionLabel(direction) },
          { label: "Amount", from: "—", to: auditMoney(amountCents) },
          ...(note ? [{ label: "Note", from: "—", to: note }] : []),
        ],
      });
    });
    afterLedgerChange();
  });
}

export async function updateLedgerEntryAction(formData: FormData): Promise<LedgerFormResult> {
  const session = await ledgerSession();
  return formResult(async () => {
    const id = readId(formData.get("id"), "line");
    const version = textField(formData.get("version"));
    const entryDate = readEntryDate(formData.get("entryDate"));
    const description = readDescription(formData.get("description"));
    const categoryId = readId(formData.get("categoryId"), "category");
    const direction = readDirection(formData.get("direction"));
    const amountCents = readAmount(formData.get("amount"));
    const note = readNote(formData.get("note"));

    await prisma.$transaction(async (tx) => {
      const before = await tx.ledgerEntry.findUnique({ where: { id }, include: { category: true } });
      if (!before || before.deletedAt) throw new LedgerInputError(LINE_GONE, true);
      if (before.transferId) {
        throw new LedgerInputError("A move between categories can't be edited. Delete it and add it again.");
      }
      if (before.updatedAt.toISOString() !== version) throw new LedgerInputError(OUT_OF_DATE, true);
      const category = await usableCategory(tx, categoryId, before.categoryId);

      // Only if nobody saved it in between: updatedAt is the version.
      const { count } = await tx.ledgerEntry.updateMany({
        where: { id, updatedAt: before.updatedAt, deletedAt: null },
        data: { entryDate, description, categoryId, direction, amountCents, note },
      });
      if (count === 0) throw new LedgerInputError(OUT_OF_DATE, true);

      await recordLedgerAudit(tx, session, {
        action: "ledger.entry.update",
        summary: `Edited the ledger line “${description}” — now ${auditMoney(amountCents)} ${direction === "IN" ? "in" : "out"}, ${category.name}`,
        entityType: "LedgerEntry",
        entityId: id,
        details: changedFields({
          Date: [before.entryDate, entryDate],
          Description: [before.description, description],
          Category: [before.category.name, category.name],
          "In / Out": [directionLabel(before.direction), directionLabel(direction)],
          Amount: [auditMoney(before.amountCents), auditMoney(amountCents)],
          Note: [before.note, note],
        }),
      });
    });
    afterLedgerChange();
  });
}

/** Marks a line deleted — both lines, for a move between categories. A second click does nothing. */
export async function deleteLedgerEntryAction(formData: FormData): Promise<void> {
  const session = await ledgerSession();
  const id = textField(formData.get("id"));
  if (!id) throw new Error("Missing line id.");

  const changed = await prisma.$transaction(async (tx) => {
    const entry = await tx.ledgerEntry.findUnique({ where: { id }, include: { category: true } });
    if (!entry || entry.deletedAt) return false;
    const deletedAt = new Date();
    const where = entry.transferId ? { transferId: entry.transferId, deletedAt: null } : { id, deletedAt: null };
    const { count } = await tx.ledgerEntry.updateMany({ where, data: { deletedAt, deletedByName: session.displayName } });
    if (count === 0) return false;

    if (entry.transferId) {
      const halves = await tx.ledgerEntry.findMany({ where: { transferId: entry.transferId }, include: { category: true } });
      const from = halves.find((h) => h.direction === "OUT")?.category.name ?? "?";
      const to = halves.find((h) => h.direction === "IN")?.category.name ?? "?";
      await recordLedgerAudit(tx, session, {
        action: "ledger.transfer.delete",
        summary: `Deleted the ${auditMoney(entry.amountCents)} move from ${from} to ${to} (“${entry.description}”) — kept under Deleted entries`,
        entityType: "LedgerEntry",
        entityId: entry.transferId,
        details: [
          { label: "Date", from: auditDate(entry.entryDate), to: "—" },
          { label: "From", from, to: "—" },
          { label: "To", from: to, to: "—" },
          { label: "Amount", from: auditMoney(entry.amountCents), to: "—" },
        ],
      });
    } else {
      await recordLedgerAudit(tx, session, {
        action: "ledger.entry.delete",
        summary: `Deleted the ${auditMoney(entry.amountCents)} ledger line “${entry.description}” — kept under Deleted entries`,
        entityType: "LedgerEntry",
        entityId: id,
        details: [
          { label: "Date", from: auditDate(entry.entryDate), to: "—" },
          { label: "Description", from: entry.description, to: "—" },
          { label: "Category", from: entry.category.name, to: "—" },
          { label: "In / Out", from: directionLabel(entry.direction), to: "—" },
          { label: "Amount", from: auditMoney(entry.amountCents), to: "—" },
        ],
      });
    }
    return true;
  });
  if (changed) afterLedgerChange();
}

/** Puts a deleted line back — both lines, for a move between categories. */
export async function restoreLedgerEntryAction(formData: FormData): Promise<void> {
  const session = await ledgerSession();
  const id = textField(formData.get("id"));
  if (!id) throw new Error("Missing line id.");

  const changed = await prisma.$transaction(async (tx) => {
    // Waits for an Undo Import running at the same moment (it takes the same
    // lock), so the check below sees whether this line's import was undone.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ledger-import'))`;
    const entry = await tx.ledgerEntry.findUnique({ where: { id }, include: { category: true, importBatch: true } });
    if (!entry || !entry.deletedAt) return false;
    // An undone import's lines come back only by importing again.
    if (entry.importBatch?.undoneAt) return false;
    const notUndone = { OR: [{ importBatchId: null }, { importBatch: { undoneAt: null } }] };
    const where = entry.transferId
      ? { transferId: entry.transferId, deletedAt: { not: null }, ...notUndone }
      : { id, deletedAt: { not: null }, ...notUndone };
    const { count } = await tx.ledgerEntry.updateMany({ where, data: { deletedAt: null, deletedByName: null } });
    if (count === 0) return false;

    await recordLedgerAudit(tx, session, {
      action: "ledger.entry.restore",
      summary: entry.transferId
        ? `Restored the ${auditMoney(entry.amountCents)} move between categories “${entry.description}” (both lines)`
        : `Restored the ${auditMoney(entry.amountCents)} ledger line “${entry.description}” (${entry.category.name})`,
      entityType: "LedgerEntry",
      entityId: entry.transferId ?? id,
      details: [
        { label: "Date", from: "—", to: auditDate(entry.entryDate) },
        { label: "Description", from: "—", to: entry.description },
        { label: "Amount", from: "—", to: auditMoney(entry.amountCents) },
      ],
    });
    return true;
  });
  if (changed) afterLedgerChange();
}

/**
 * Moves money from one category to another — a close-out, say. Two lines on
 * the same date, OUT of one and IN to the other, sharing a transferId, so the
 * bank balance doesn't change.
 */
export async function addLedgerTransferAction(formData: FormData): Promise<LedgerFormResult> {
  const session = await ledgerSession();
  return formResult(async () => {
    const entryDate = readEntryDate(formData.get("entryDate"));
    const fromId = readId(formData.get("fromCategoryId"), "category to move from");
    const toId = readId(formData.get("toCategoryId"), "category to move to");
    if (fromId === toId) throw new LedgerInputError("Pick two different categories.");
    const amountCents = readAmount(formData.get("amount"));
    // Blank: "Move from <From> to <To>", filled in below once the names are known.
    const typed = textField(formData.get("description")) ? readDescription(formData.get("description")) : null;
    const note = readNote(formData.get("note"));

    await prisma.$transaction(async (tx) => {
      const from = await usableCategory(tx, fromId);
      const to = await usableCategory(tx, toId);
      const description = typed ?? `Move from ${from.name} to ${to.name}`.slice(0, MAX_DESCRIPTION_LENGTH);
      const transferId = randomUUID();
      const common = {
        entryDate,
        description,
        amountCents,
        note,
        origin: "MANUAL" as const,
        transferId,
        createdByUserId: session.userId,
        createdByName: session.displayName,
      };
      await tx.ledgerEntry.create({ data: { ...common, categoryId: from.id, direction: "OUT" } });
      await tx.ledgerEntry.create({ data: { ...common, categoryId: to.id, direction: "IN" } });
      await recordLedgerAudit(tx, session, {
        action: "ledger.transfer.add",
        summary: `Moved ${auditMoney(amountCents)} from ${from.name} to ${to.name} (“${description}”) — the bank balance is unchanged`,
        entityType: "LedgerEntry",
        entityId: transferId,
        details: [
          { label: "Date", from: "—", to: auditDate(entryDate) },
          { label: "From", from: "—", to: from.name },
          { label: "To", from: "—", to: to.name },
          { label: "Amount", from: "—", to: auditMoney(amountCents) },
          { label: "Description", from: "—", to: description },
          ...(note ? [{ label: "Note", from: "—", to: note }] : []),
        ],
      });
    });
    afterLedgerChange();
  });
}

// ---------- Categories ----------

export async function createLedgerCategoryAction(formData: FormData): Promise<LedgerFormResult> {
  const session = await ledgerSession();
  return formResult(async () => {
    const name = readCategoryName(formData.get("name"));
    const kind = readKind(formData.get("kind"));
    const typedOrder = formData.get("sortOrder");

    try {
      await prisma.$transaction(async (tx) => {
        const nameKey = ledgerCategoryNameKey(name);
        if (await tx.ledgerCategory.findUnique({ where: { nameKey }, select: { id: true } })) {
          throw new LedgerInputError(CATEGORY_TAKEN);
        }
        // A new category goes to the end unless an order is given.
        const last = await tx.ledgerCategory.aggregate({ _max: { sortOrder: true } });
        const sortOrder = readSortOrder(typedOrder, Math.min((last._max.sortOrder ?? 0) + 10, MAX_SORT_ORDER));
        const category = await tx.ledgerCategory.create({ data: { name, nameKey, kind, sortOrder } });
        await recordLedgerAudit(tx, session, {
          action: "ledger.category.create",
          summary: `Added the ledger category “${name}” (${kindLabel(kind)})`,
          entityType: "LedgerCategory",
          entityId: category.id,
          details: [
            { label: "Name", from: "—", to: name },
            { label: "Kind", from: "—", to: kindLabel(kind) },
            { label: "Order", from: "—", to: String(sortOrder) },
          ],
        });
      });
    } catch (error) {
      // Two people adding the same name at once: the unique index stopped the second.
      if (isUniqueViolation(error)) throw new LedgerInputError(CATEGORY_TAKEN);
      throw error;
    }
    afterLedgerChange();
  });
}

/** Rename, Fund/Event, order and archived. Archiving keeps the lines and the balance; it only leaves the pickers. */
export async function updateLedgerCategoryAction(formData: FormData): Promise<LedgerFormResult> {
  const session = await ledgerSession();
  return formResult(async () => {
    const id = readId(formData.get("id"), "category");
    const name = readCategoryName(formData.get("name"));
    const kind = readKind(formData.get("kind"));
    const archivedRaw = textField(formData.get("archived"));
    const archived = archivedRaw === "on" || archivedRaw === "true";

    try {
      await prisma.$transaction(async (tx) => {
        const before = await tx.ledgerCategory.findUnique({ where: { id } });
        if (!before) throw new LedgerInputError(CATEGORY_GONE, true);
        const sortOrder = readSortOrder(formData.get("sortOrder"), before.sortOrder);
        const nameKey = ledgerCategoryNameKey(name);
        if (nameKey !== before.nameKey) {
          const other = await tx.ledgerCategory.findUnique({ where: { nameKey }, select: { id: true } });
          if (other && other.id !== id) throw new LedgerInputError(CATEGORY_TAKEN);
        }
        await tx.ledgerCategory.update({ where: { id }, data: { name, nameKey, kind, sortOrder, archived } });
        const details = changedFields({
          Name: [before.name, name],
          Kind: [kindLabel(before.kind), kindLabel(kind)],
          Order: [before.sortOrder, sortOrder],
          Archived: [before.archived, archived],
        });
        if (details.length === 0) return;
        await recordLedgerAudit(tx, session, {
          action: "ledger.category.update",
          summary:
            before.name === name ? `Edited the ledger category “${name}”` : `Renamed the ledger category “${before.name}” to “${name}”`,
          entityType: "LedgerCategory",
          entityId: id,
          details,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new LedgerInputError(CATEGORY_TAKEN);
      throw error;
    }
    afterLedgerChange();
  });
}

/** Only a category no line has ever used — deleted lines included, since they can be restored. */
export async function deleteLedgerCategoryAction(formData: FormData): Promise<LedgerFormResult> {
  const session = await ledgerSession();
  return formResult(async () => {
    const id = readId(formData.get("id"), "category");
    let deleted = false;
    try {
      await prisma.$transaction(async (tx) => {
        const category = await tx.ledgerCategory.findUnique({ where: { id }, include: { _count: { select: { entries: true } } } });
        if (!category) return;
        if (category._count.entries > 0) {
          throw new LedgerInputError(
            `“${category.name}” has lines in the ledger (deleted ones count too), so it can't be deleted. Archive it instead.`,
          );
        }
        await tx.ledgerCategory.delete({ where: { id } });
        await recordLedgerAudit(tx, session, {
          action: "ledger.category.delete",
          summary: `Deleted the unused ledger category “${category.name}”`,
          entityType: "LedgerCategory",
          entityId: id,
          details: [
            { label: "Name", from: category.name, to: "—" },
            { label: "Kind", from: kindLabel(category.kind), to: "—" },
          ],
        });
        deleted = true;
      });
    } catch (error) {
      // A line was added to it in the meantime: the foreign key refused the delete.
      if ((error as { code?: unknown })?.code === "P2003") {
        throw new LedgerInputError("That category is now in use, so it can't be deleted. Archive it instead.", true);
      }
      throw error;
    }
    if (deleted) afterLedgerChange();
  });
}

// ---------- Settings ----------

/** The Google Sheet copy on or off. (The cutover date is set by the import.) */
export async function updateLedgerSettingsAction(formData: FormData): Promise<LedgerFormResult> {
  const session = await ledgerSession();
  return formResult(async () => {
    const raw = textField(formData.get("syncEnabled"));
    if (raw !== "true" && raw !== "false") throw new LedgerInputError("Choose on or off.");
    const syncEnabled = raw === "true";

    let changed = false;
    await prisma.$transaction(async (tx) => {
      const before = await tx.ledgerSettings.findUnique({ where: { id: "main" }, select: { syncEnabled: true } });
      const wasEnabled = before?.syncEnabled ?? true;
      await tx.ledgerSettings.upsert({ where: { id: "main" }, create: { id: "main", syncEnabled }, update: { syncEnabled } });
      if (wasEnabled === syncEnabled) return;
      await recordLedgerAudit(tx, session, {
        action: "ledger.settings.update",
        summary: syncEnabled
          ? "Turned the Ledger's Google Sheet copy back on"
          : "Turned the Ledger's Google Sheet copy off — the portal stops updating its tab",
        entityType: "LedgerSettings",
        entityId: "main",
        details: changedFields({ "Google Sheet copy": [wasEnabled ? "On" : "Off", syncEnabled ? "On" : "Off"] }),
      });
      changed = true;
    });
    if (changed) afterLedgerChange();
  });
}
