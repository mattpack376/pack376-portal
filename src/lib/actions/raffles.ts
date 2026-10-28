"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  RAFFLE_HELPER_ROLES,
  assertAdmin,
  assertCanMutateUser,
  assertMasterAdmin,
  raffleAccessFor,
} from "@/lib/authorize";
import { ROLE_LABELS } from "@/lib/roleLabels";
import { recordAuditInTransaction, changedFields, auditMoney, auditDate } from "@/lib/audit";
import {
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  dollarsToCents,
  multiplyCents,
  parseCount,
  textField,
} from "@/lib/formValues";
import { parseDateOnlyString, todayDateOnlyString } from "@/lib/dateOnly";
import {
  MAX_RAFFLE_BOXES,
  RAFFLE_METHOD_LABELS,
  buyerNameKey,
  formatBoxNumbers,
  isRaffleMethod,
  parseBoxNumbers,
  prizeForSales,
  type RaffleMethod,
} from "@/lib/raffleMath";
import { parseRaffleImport } from "@/lib/raffleImport";
import { entryEditVersion, paymentEditVersion, raffleTermsVersion } from "@/lib/raffleEditVersion";
import type { Prisma, Raffle } from "@/generated/prisma/client";

/*
 * Everything that changes a 50/50 raffle. Two levels may change one (see
 * raffleAccessFor in authorize.ts):
 *
 *  - sellerSession(): an Admin, or someone with the Raffle Helper permission.
 *    Selling boxes, editing a buyer, taking away a box picked by mistake,
 *    removing a buyer who hasn't paid, recording a buyer's payment, and
 *    voiding a payment — for a helper, only their own unverified ones.
 *  - adminSession(): Admin only. Everything else — starting, changing,
 *    closing and deleting raffles, verifying, correcting and restoring
 *    payments, money not matched to a buyer, the winner and the prize.
 *
 * A Junior Admin without the permission reads the pages and changes nothing.
 *
 * Every action hands back { error } for a refusal a person can act on — a box
 * that's taken, a winning number nobody bought, a payment someone else
 * changed a moment ago — and the forms show it (ActionForm, EditPopover). A
 * thrown error in production replaces the page with a generic message that
 * says nothing about which box. Only a tampered request (no session, the
 * wrong level) still throws.
 *
 * A closed raffle refuses every change until it's reopened, and box
 * assignments freeze once the winner is recorded: the prize is fixed from the
 * boxes sold at that moment, so the board can't shift underneath it. Money
 * can still be collected after the drawing.
 *
 * One lock keeps all of that true when several people work a raffle at once.
 * Every change runs in a transaction that first locks the raffle's own row
 * (withLockedRaffle), then re-reads whatever it checks — the raffle, the
 * buyer, the payment, the board — and only then decides and writes. Two
 * changes to one raffle therefore happen one after the other, each seeing
 * everything the other saved: a sale can't land after the winner froze the
 * board or after the raffle closed, a helper can't void a payment an Admin
 * verified a moment before, and a payment can't be recorded against a buyer
 * who is being removed. The raffle row is always locked first, before any of
 * its buyers, boxes or payments, so two of these can't deadlock each other.
 * The writes that depend on a payment's state also say that state in their
 * WHERE clause (updateMany + a count check), as a second guard. A change that
 * can't get the lock within LOCK_TIMEOUT gives up with a "try again" message
 * rather than hanging the form (see raffleTransaction).
 *
 * What a form showed counts too. A paid sale carries the price per box its
 * page showed, and an Edit form a fingerprint of the values it was filled in
 * with (raffleEditVersion.ts): if the raffle or the row changed since the page
 * loaded, the save is refused with a "refresh" message rather than recording
 * money that never changed hands or putting someone else's correction back.
 *
 * A buyer is identified by name: a name already on the raffle (however it's
 * capitalized, accents included, ignoring spaces at either end — see
 * buyerNameKey in raffleMath.ts) gets more boxes on that line, and Edit
 * refuses a name another buyer on the raffle already has. Two different
 * people who share a name have to be entered with names that tell them apart
 * — a last name or initial ("Frank Smith", "Frank R.") — which is how the
 * October 2026 raffle already lists its two Franks and two Joses. The check
 * runs under the raffle lock; a unique index on the lower-cased name (see the
 * 20261027130000 migration) backs it up where the data allowed one.
 *
 * Audit entries for these changes are written inside the same transaction
 * (recordAuditInTransaction): the change and its record commit together.
 */

const LIST_PATH = "/portal/admin/raffles";
const rafflePath = (raffleId: string) => `${LIST_PATH}/${raffleId}`;

export type RaffleFormResult = { error?: string };

/** A mistake in what was entered, or state that changed underneath the form — shown on the form rather than thrown to the error page. */
class RaffleInputError extends Error {}

type Tx = Prisma.TransactionClient;

/**
 * Prisma's limits on one raffle transaction. `timeout` can't interrupt a
 * query that is waiting for a lock — the waiting change would sit there for
 * as long as the lock is held — so raffleTransaction also sets Postgres's own
 * limits below.
 */
const TX_OPTIONS = { timeout: 15_000, maxWait: 10_000 };

/**
 * The longest any one statement in a raffle transaction waits for a lock (the
 * raffle row, a payment, a login row its foreign keys point at). A raffle
 * change takes milliseconds, so a wait this long means the holder is stuck;
 * the waiting change then fails with BUSY, having saved nothing.
 */
const LOCK_TIMEOUT = "10s";

/**
 * Ends the database session of a raffle transaction that sits idle — its
 * server function frozen or killed between two statements — for this long,
 * which releases the raffle lock it holds. Without it a dead holder could
 * keep every change to that raffle failing for hours. Live transactions never
 * pause this long between statements; Prisma's own `timeout` ends them sooner.
 */
const IDLE_TIMEOUT = "30s";

/** A Postgres error code (SQLSTATE) that Prisma passed through from the driver, if any. */
function postgresErrorCode(error: unknown): string | undefined {
  const cause = (error as { meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } } } | null)?.meta?.driverAdapterError
    ?.cause;
  return typeof cause?.originalCode === "string" ? cause.originalCode : undefined;
}

const RAFFLE_GONE = "This raffle no longer exists. Go back to the list of raffles.";
const RAFFLE_CLOSED = "This raffle is closed. Reopen it before changing anything.";
const BUYER_GONE = "That buyer isn't on this raffle any more. Refresh and try again.";
const PAYMENT_GONE = "That payment is gone. Refresh and try again.";
const PAYMENT_CHANGED = "That payment changed a moment ago. Nothing was saved — refresh and try again.";
const PAGE_OUT_OF_DATE = "This page is out of date. Refresh it and try again.";
const TAKEN_MEANWHILE = "One of those boxes was taken a moment ago. Nothing was saved — check the board and try again.";
const NAME_TAKEN_MEANWHILE =
  "A buyer with that name was added a moment ago. Nothing was saved — refresh and try again.";
const BUSY = "Someone else is saving a change to this raffle right now. Wait a moment and try again.";

function prismaErrorCode(error: unknown) {
  return typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
}

/** Which table a unique-index refusal came from ("RaffleBox", "RaffleEntry"), if it was one. */
function uniqueViolationModel(error: unknown): string | null {
  if (prismaErrorCode(error) !== "P2002") return null;
  const meta = (error as { meta?: { modelName?: unknown } }).meta;
  return typeof meta?.modelName === "string" ? meta.modelName : "";
}

async function asResult(work: () => Promise<void>): Promise<RaffleFormResult> {
  try {
    await work();
    return {};
  } catch (error) {
    if (error instanceof RaffleInputError) return { error: error.message };
    // The raffle lock makes both of these all but impossible; they stay as
    // a backstop for a writer that doesn't take it. Two sales of one number
    // meet the (raffleId, number) index; two new buyers with one name meet
    // the buyer-name index.
    const model = uniqueViolationModel(error);
    if (model === "RaffleEntry") return { error: NAME_TAKEN_MEANWHILE };
    if (model !== null) return { error: TAKEN_MEANWHILE };
    // A lock wait past LOCK_TIMEOUT (55P03, almost always the raffle lock
    // behind a stuck change), a transaction that ran past TX_OPTIONS.timeout,
    // or one Postgres chose to abort to break a deadlock. Nothing was saved
    // in any of them.
    const code = prismaErrorCode(error);
    if (code === "P2028" || code === "P2034" || postgresErrorCode(error) === "55P03") return { error: BUSY };
    throw error;
  }
}

async function adminSession() {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);
  return session;
}

/** An Admin or a Raffle Helper — the people who work the board during a raffle. */
async function sellerSession() {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  const access = await raffleAccessFor(session);
  if (access !== "admin" && access !== "helper") throw new Error("Not authorized: raffle access required.");
  return { session, isAdmin: access === "admin" };
}

function revalidateRaffle(raffleId: string) {
  revalidatePath(LIST_PATH);
  revalidatePath(rafflePath(raffleId));
}

/**
 * An interactive transaction for raffle changes. Its first statement sets
 * LOCK_TIMEOUT and IDLE_TIMEOUT for this transaction only (set_config(…,
 * true) is SET LOCAL), before anything that might wait for a lock.
 */
async function raffleTransaction<T>(
  work: (tx: Tx) => Promise<T>,
  options: { timeout: number; maxWait: number } = TX_OPTIONS
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('lock_timeout', ${LOCK_TIMEOUT}, true), set_config('idle_in_transaction_session_timeout', ${IDLE_TIMEOUT}, true)`;
    return work(tx);
  }, options);
}

/**
 * Runs `work` in one transaction that holds the raffle's row lock (FOR
 * UPDATE) from its first statement to its commit, handing it the raffle as it
 * stands once the lock is held. Every action that changes a raffle — its
 * terms, board, payments, drawing or status — goes through here, so they
 * queue up one behind another per raffle. FOR UPDATE also holds back an
 * insert of a box, buyer or payment by anything that doesn't take the lock,
 * since the foreign key check on raffleId has to wait for it.
 *
 * Refuses a closed raffle unless `allowClosed` (reopening, deleting, and
 * closing it again, which is then a no-op).
 */
async function withLockedRaffle<T>(
  raffleId: string,
  work: (tx: Tx, raffle: Raffle) => Promise<T>,
  { allowClosed = false }: { allowClosed?: boolean } = {}
): Promise<T> {
  if (!raffleId) throw new RaffleInputError(RAFFLE_GONE);
  return raffleTransaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Raffle" WHERE "id" = ${raffleId} FOR UPDATE`;
    if (locked.length === 0) throw new RaffleInputError(RAFFLE_GONE);
    // A fresh read, after the lock: it sees everything committed by whoever
    // held the lock before.
    const raffle = await tx.raffle.findUniqueOrThrow({ where: { id: raffleId } });
    if (!allowClosed && raffle.status === "CLOSED") throw new RaffleInputError(RAFFLE_CLOSED);
    return work(tx, raffle);
  });
}

/** Which raffle a buyer belongs to — only to know which lock to take; the buyer is read again under it. */
async function raffleIdOfEntry(entryId: string) {
  const entry = entryId ? await prisma.raffleEntry.findUnique({ where: { id: entryId }, select: { raffleId: true } }) : null;
  if (!entry) throw new RaffleInputError(BUYER_GONE);
  return entry.raffleId;
}

/** Which raffle a payment belongs to — only to know which lock to take; the payment is read again under it. */
async function raffleIdOfPayment(paymentId: string) {
  const payment = paymentId
    ? await prisma.rafflePayment.findUnique({ where: { id: paymentId }, select: { raffleId: true } })
    : null;
  if (!payment) throw new RaffleInputError(PAYMENT_GONE);
  return payment.raffleId;
}

/**
 * A paid sale records boxes × price as money received, so the price has to be
 * the one the seller's page showed — what they actually asked for and took.
 * If an Admin changed the price after that page loaded, nothing is saved and
 * the seller is asked to refresh and collect the right amount.
 */
function assertShownPrice(shownPriceCents: number | null, raffle: Raffle) {
  if (shownPriceCents === null) throw new RaffleInputError(PAGE_OUT_OF_DATE);
  if (shownPriceCents !== raffle.priceCents) {
    throw new RaffleInputError(
      `The price per box changed from ${auditMoney(shownPriceCents)} to ${auditMoney(raffle.priceCents)} after this page loaded. Nothing was saved — refresh the page, collect the right amount, and try again.`
    );
  }
}

function assertBoardUnlocked(raffle: Raffle) {
  if (raffle.winningBox !== null) {
    throw new RaffleInputError(
      "The winner is already recorded, so the board is locked. Clear the winner first if a box really needs to change."
    );
  }
}

function field(formData: FormData, name: string) {
  return textField(formData.get(name));
}

/**
 * Refuses text longer than the field allows, or holding a NUL character
 * (Postgres can't store one in text, so it would fail the save with a
 * generic error instead of this message).
 */
function checkText(value: string, max: number, label: string) {
  if (value.length > max) throw new RaffleInputError(`${label} can be at most ${max} characters.`);
  if (value.includes("\u0000")) throw new RaffleInputError(`${label} can't be saved with an invisible NUL character in it.`);
  return value;
}

function nameField(formData: FormData, name: string, label: string) {
  return checkText(field(formData, name), MAX_NAME_LENGTH, label);
}

function noteField(formData: FormData, name: string, label: string) {
  return checkText(field(formData, name), MAX_NOTE_LENGTH, label);
}

function methodField(formData: FormData, name: string): RaffleMethod {
  const value = field(formData, name);
  if (!isRaffleMethod(value)) throw new RaffleInputError("Choose how it was paid.");
  return value;
}

function dateField(formData: FormData, name: string): Date | null {
  try {
    return parseDateOnlyString(field(formData, name));
  } catch {
    throw new RaffleInputError("That date isn't valid.");
  }
}

function boxWord(count: number) {
  return count === 1 ? "box" : "boxes";
}

/** What `count` boxes cost. Terms are bounded so a whole board fits under MAX_CENTS; this is the backstop. */
function boxesCost(count: number, priceCents: number) {
  const cents = multiplyCents(count, priceCents);
  if (cents === null) throw new RaffleInputError("That adds up to more than $1,000,000, which is more than the portal records at once.");
  return cents;
}

/** The winner's share of the boxes sold, with the same bound on the sales it's cut from. */
function prizeFor(soldBoxes: number, raffle: Raffle) {
  boxesCost(soldBoxes, raffle.priceCents);
  return prizeForSales(soldBoxes, raffle.priceCents, raffle.prizePercent);
}

/** Shared by New Raffle and Edit Raffle. */
function readRaffleTerms(formData: FormData) {
  const name = nameField(formData, "name", "The raffle name");
  if (!name) throw new RaffleInputError("Give the raffle a name.");
  const rawBoxCount = field(formData, "boxCount");
  const boxCount = rawBoxCount ? parseCount(rawBoxCount, MAX_RAFFLE_BOXES) : null;
  if (boxCount === null || boxCount < 1) {
    throw new RaffleInputError(`The number of boxes must be between 1 and ${MAX_RAFFLE_BOXES}.`);
  }
  const priceCents = dollarsToCents(field(formData, "price"));
  if (priceCents === null || priceCents === 0) throw new RaffleInputError("Enter a price per box above $0.");
  // A full board has to stay inside what one amount may be, so every sale,
  // total and prize worked out from these terms does too.
  if (multiplyCents(boxCount, priceCents) === null) {
    throw new RaffleInputError(
      `${boxCount} boxes at ${auditMoney(priceCents)} would come to more than $1,000,000. Lower the price or the number of boxes.`
    );
  }
  const rawPercent = field(formData, "prizePercent");
  const prizePercent = rawPercent ? parseCount(rawPercent, 100) : null;
  if (prizePercent === null) {
    throw new RaffleInputError("The winner's share must be a whole percentage from 0 to 100.");
  }
  return {
    name,
    boxCount,
    priceCents,
    prizePercent,
    drawingDate: dateField(formData, "drawingDate"),
    notes: noteField(formData, "notes", "The notes") || null,
  };
}

export async function createRaffleAction(formData: FormData): Promise<RaffleFormResult> {
  const session = await adminSession();
  let raffleId = "";

  const result = await asResult(async () => {
    const terms = readRaffleTerms(formData);
    raffleId = await raffleTransaction(async (tx) => {
      const raffle = await tx.raffle.create({ data: terms });
      await recordAuditInTransaction(tx, session, {
        action: "raffle.create",
        summary: `Started the raffle “${terms.name}”`,
        entityType: "Raffle",
        entityId: raffle.id,
        details: [
          { label: "Boxes", from: "—", to: String(terms.boxCount) },
          { label: "Price per box", from: "—", to: auditMoney(terms.priceCents) },
          { label: "Winner's share", from: "—", to: `${terms.prizePercent}%` },
          ...(terms.drawingDate ? [{ label: "Drawing date", from: "—", to: auditDate(terms.drawingDate) }] : []),
        ],
      });
      return raffle.id;
    });
  });
  if (result.error) return result;

  revalidatePath(LIST_PATH);
  redirect(rafflePath(raffleId));
}

/**
 * The raffle's settings: name, drawing date, board size, price, winner's
 * share and notes. The form sends all of them every time, so it also carries
 * raffleTermsVersion of the settings it was filled in with. If another Admin
 * changed any of them since that page loaded — raised the winner's share,
 * resized the board, moved the drawing — the save is refused rather than
 * quietly putting the old ones back along with whatever this Admin meant to
 * change. Selling boxes, payments and the drawing don't touch the settings,
 * so they don't make the form out of date; the checks below cover those.
 */
export async function updateRaffleAction(formData: FormData): Promise<RaffleFormResult> {
  const session = await adminSession();
  return asResult(async () => {
    const raffleId = field(formData, "raffleId");
    const terms = readRaffleTerms(formData);
    const version = field(formData, "version");
    if (!version) throw new RaffleInputError(PAGE_OUT_OF_DATE);

    await withLockedRaffle(raffleId, async (tx, raffle) => {
      // `raffle` is read under its own row lock, which this transaction keeps
      // until it commits, so the settings can't change between this check
      // and the save below.
      if (raffleTermsVersion(raffle) !== version) {
        throw new RaffleInputError(
          `Someone changed this raffle's settings after this page loaded (it's now ${raffle.boxCount} ${boxWord(raffle.boxCount)} at ${auditMoney(raffle.priceCents)} each, ${raffle.prizePercent}% to the winner). Nothing was saved — refresh the page and make your change again.`
        );
      }

      // Read under the lock, so a sale or a payment can't slip in between
      // these checks and the save.
      const [highestBox, livePayments] = await Promise.all([
        tx.raffleBox.findFirst({ where: { raffleId }, orderBy: { number: "desc" }, select: { number: true } }),
        tx.rafflePayment.count({ where: { raffleId, voidedAt: null } }),
      ]);
      if (highestBox && terms.boxCount < highestBox.number) {
        throw new RaffleInputError(`Box ${highestBox.number} is already sold, so the board can't be smaller than that.`);
      }
      if (terms.priceCents !== raffle.priceCents && livePayments > 0) {
        throw new RaffleInputError("Payments have already been recorded at the current price, so the price can't change now.");
      }
      if (raffle.winningBox !== null && (terms.priceCents !== raffle.priceCents || terms.prizePercent !== raffle.prizePercent)) {
        throw new RaffleInputError("The winner is already recorded, so the price and the winner's share are fixed.");
      }

      await tx.raffle.update({ where: { id: raffleId }, data: terms });

      await recordAuditInTransaction(tx, session, {
        action: "raffle.update",
        summary: `Edited the raffle “${terms.name}”`,
        entityType: "Raffle",
        entityId: raffleId,
        details: changedFields({
          Name: [raffle.name, terms.name],
          "Drawing date": [raffle.drawingDate, terms.drawingDate],
          Boxes: [raffle.boxCount, terms.boxCount],
          "Price per box": [auditMoney(raffle.priceCents), auditMoney(terms.priceCents)],
          "Winner's share": [`${raffle.prizePercent}%`, `${terms.prizePercent}%`],
          Notes: [raffle.notes, terms.notes],
        }),
      });
    });
    revalidateRaffle(raffleId);
  });
}

/** Box numbers as typed: whole numbers only. Checked against the board's size under the lock (assertOnBoard). */
function readBoxNumbers(raw: string) {
  const numbers = parseBoxNumbers(raw);
  if (numbers === null) throw new RaffleInputError("Box numbers should be whole numbers separated by commas, like 12, 15, 18.");
  return numbers;
}

function assertOnBoard(numbers: number[], boxCount: number) {
  const offBoard = numbers.filter((number) => number > boxCount);
  if (offBoard.length > 0) {
    throw new RaffleInputError(`This board only goes up to ${boxCount} — there is no box ${formatBoxNumbers(offBoard)}.`);
  }
}

/** Says who already holds any of these boxes, so the message names the buyer rather than just the number. */
async function assertBoxesFree(tx: Tx, raffleId: string, numbers: number[], exceptEntryId?: string) {
  const taken = await tx.raffleBox.findMany({
    where: { raffleId, number: { in: numbers }, ...(exceptEntryId ? { entryId: { not: exceptEntryId } } : {}) },
    select: { number: true, entry: { select: { name: true } } },
    orderBy: { number: "asc" },
  });
  if (taken.length === 0) return;
  const list = taken.map((box) => `${box.number} (${box.entry.name})`).join(", ");
  throw new RaffleInputError(`Already taken: box ${list}. Nothing was saved.`);
}

/**
 * The buyer on this raffle with this name: the same buyerNameKey (case,
 * accents typed either way, spaces at either end), which is what the board's
 * hint promised. Also a name the buyer-name index would call the same
 * (Postgres's lower(btrim())), so the index never refuses a save this check
 * let through — on a "C"-locale database that index only folds A–Z, and
 * elsewhere a few letters (a Turkish dotted İ, a Greek final sigma) fold
 * differently in Postgres than in JavaScript. Compared exactly, never as a
 * pattern: Prisma's `mode: "insensitive"` equals is an ILIKE, where a typed
 * "%" or "_" matched other people's names. The oldest match wins if old data
 * ever holds two.
 */
async function buyerNamed(tx: Tx, raffleId: string, name: string, exceptEntryId = "") {
  const rows = await tx.$queryRaw<{ id: string; name: string; sameInIndex: boolean }[]>`
    SELECT "id", "name", lower(btrim("name")) = lower(btrim(${name}::text)) AS "sameInIndex"
    FROM "RaffleEntry"
    WHERE "raffleId" = ${raffleId} AND "id" <> ${exceptEntryId}
    ORDER BY "createdAt" ASC, "id" ASC`;
  const key = buyerNameKey(name);
  const match = rows.find((row) => row.sameInIndex || buyerNameKey(row.name) === key);
  return match ? { id: match.id, name: match.name } : null;
}

/**
 * Gives boxes to a buyer — a new one, or more boxes for someone already on
 * this raffle — and, when they paid on the spot, records that payment for the
 * full price of the boxes in the same step.
 */
export async function assignBoxesAction(formData: FormData): Promise<RaffleFormResult> {
  const { session } = await sellerSession();
  return asResult(async () => {
    const raffleId = field(formData, "raffleId");
    const numbers = readBoxNumbers(field(formData, "boxes"));
    if (numbers.length === 0) throw new RaffleInputError("Pick at least one box.");

    // The name decides who gets the boxes: one that's already on this raffle
    // (however it's capitalized) gets more boxes, anything else is a new
    // buyer. The forms say which it will be before the admin saves.
    const newName = nameField(formData, "name", "The buyer's name");
    if (!newName) throw new RaffleInputError("Enter the buyer's name.");

    const paid = field(formData, "paid");
    const method = paid ? methodField(formData, "paid") : null;
    const payerName = nameField(formData, "payerName", "The name it was paid by") || null;
    // The price per box the page showed; only a paid sale needs it.
    const shownPriceCents = centsField(formData, "priceCents");

    await withLockedRaffle(raffleId, async (tx, raffle) => {
      assertBoardUnlocked(raffle);
      if (method) assertShownPrice(shownPriceCents, raffle);
      assertOnBoard(numbers, raffle.boxCount);
      await assertBoxesFree(tx, raffleId, numbers);
      // The price as it stands under the lock — for a paid sale, the same one
      // the seller's page showed (assertShownPrice).
      const amountCents = boxesCost(numbers.length, raffle.priceCents);

      const buyer =
        (await buyerNamed(tx, raffleId, newName)) ??
        (await tx.raffleEntry.create({ data: { raffleId, name: newName }, select: { id: true, name: true } }));
      await tx.raffleBox.createMany({
        data: numbers.map((number) => ({ raffleId, entryId: buyer.id, number })),
      });
      if (method) {
        await tx.rafflePayment.create({
          data: {
            raffleId,
            entryId: buyer.id,
            method,
            amountCents,
            payerName,
            receivedOn: parseDateOnlyString(todayDateOnlyString()),
            recordedByUserId: session.userId,
          },
        });
      }

      const paidText = method ? `, paid ${auditMoney(amountCents)} by ${RAFFLE_METHOD_LABELS[method].toLowerCase()}` : ", not paid yet";
      await recordAuditInTransaction(tx, session, {
        action: "raffle.box.assign",
        summary: `Gave ${boxWord(numbers.length)} ${formatBoxNumbers(numbers)} to ${buyer.name} on “${raffle.name}”${paidText}`,
        entityType: "RaffleEntry",
        entityId: buyer.id,
        details: [
          { label: "Boxes", from: "—", to: formatBoxNumbers(numbers) },
          { label: "Owes for these", from: "—", to: auditMoney(amountCents) },
          ...(method ? [{ label: "Paid", from: "—", to: `${auditMoney(amountCents)} ${RAFFLE_METHOD_LABELS[method]}` }] : []),
          ...(method && payerName ? [{ label: "Paid by", from: "—", to: payerName }] : []),
        ],
      });
    });
    revalidateRaffle(raffleId);
  });
}

/**
 * A buyer's name and notes. Their boxes change through changeEntryBoxesAction.
 * The form carries entryEditVersion of the name and notes it showed; if
 * someone changed either since, the save is refused rather than putting the
 * old ones back.
 */
export async function updateEntryAction(formData: FormData): Promise<RaffleFormResult> {
  const { session } = await sellerSession();
  return asResult(async () => {
    const entryId = field(formData, "entryId");
    const name = nameField(formData, "name", "The buyer's name");
    if (!name) throw new RaffleInputError("Enter the buyer's name.");
    const notes = noteField(formData, "notes", "The notes") || null;
    const version = field(formData, "version");
    if (!version) throw new RaffleInputError(PAGE_OUT_OF_DATE);
    const raffleId = await raffleIdOfEntry(entryId);

    await withLockedRaffle(raffleId, async (tx, raffle) => {
      const entry = await tx.raffleEntry.findFirst({ where: { id: entryId, raffleId } });
      if (!entry) throw new RaffleInputError(BUYER_GONE);
      if (entryEditVersion(entry) !== version) {
        throw new RaffleInputError(
          `Someone changed this buyer's name or notes after this page loaded (they're now listed as ${entry.name}). Nothing was saved — refresh the page and make your change again.`
        );
      }

      // Selling by name finds the buyer by their name, so two buyers on one
      // raffle can't share one.
      const sameName = await buyerNamed(tx, raffleId, name, entry.id);
      if (sameName) {
        throw new RaffleInputError(
          `There is already a buyer named ${sameName.name} on this raffle. Add something to tell them apart, like a last name or initial.`
        );
      }

      // Only while the name and notes are still the ones just checked.
      const { count } = await tx.raffleEntry.updateMany({
        where: { id: entry.id, raffleId, name: entry.name, notes: entry.notes },
        data: { name, notes },
      });
      if (count !== 1) throw new RaffleInputError(PAGE_OUT_OF_DATE);

      await recordAuditInTransaction(tx, session, {
        action: "raffle.entry.update",
        summary: `Edited ${name} on “${raffle.name}”`,
        entityType: "RaffleEntry",
        entityId: entry.id,
        details: changedFields({ Name: [entry.name, name], Notes: [entry.notes, notes] }),
      });
    });
    revalidateRaffle(raffleId);
  });
}

/**
 * Changes which boxes one buyer holds, on their own line: takes away any
 * picked in error ("remove", one value per box) and adds new ones ("add", as
 * typed) — either or both in one save. The added boxes can be paid for in the
 * same step. What the buyer owes follows from the boxes they end up with.
 */
export async function changeEntryBoxesAction(formData: FormData): Promise<RaffleFormResult> {
  const { session } = await sellerSession();
  return asResult(async () => {
    const entryId = field(formData, "entryId");
    const asked = new Set(formData.getAll("remove").map((value) => (typeof value === "string" ? Number(value) : NaN)));
    const requested = readBoxNumbers(field(formData, "add"));
    const paid = field(formData, "paid");
    const paidMethod = paid ? methodField(formData, "paid") : null;
    const payerName = nameField(formData, "payerName", "The name it was paid by") || null;
    const shownPriceCents = centsField(formData, "priceCents");
    const raffleId = await raffleIdOfEntry(entryId);

    await withLockedRaffle(raffleId, async (tx, raffle) => {
      // The buyer's boxes as they are now: the form's ticks are only a
      // request, and someone may have changed this line since it loaded.
      const entry = await tx.raffleEntry.findFirst({
        where: { id: entryId, raffleId },
        include: { boxes: { select: { number: true }, orderBy: { number: "asc" } } },
      });
      if (!entry) throw new RaffleInputError(BUYER_GONE);
      assertBoardUnlocked(raffle);

      const before = entry.boxes.map((box) => box.number);
      const dropped = before.filter((number) => asked.has(number));
      assertOnBoard(requested, raffle.boxCount);
      const added = requested.filter((number) => !before.includes(number));
      if (dropped.length === 0 && added.length === 0) {
        throw new RaffleInputError("Nothing to change — tick a box to take away, or type a box number to add.");
      }

      const after = [...before.filter((number) => !dropped.includes(number)), ...added].sort((a, b) => a - b);
      if (after.length === 0) {
        throw new RaffleInputError(
          `That would leave ${entry.name} with no boxes. To take them off the raffle altogether, use Remove on the Buyers tab.`
        );
      }

      const method = added.length > 0 ? paidMethod : null;
      if (method) assertShownPrice(shownPriceCents, raffle);
      const paidCents = boxesCost(added.length, raffle.priceCents);
      if (added.length > 0) await assertBoxesFree(tx, raffleId, added, entry.id);

      if (dropped.length > 0) await tx.raffleBox.deleteMany({ where: { entryId: entry.id, number: { in: dropped } } });
      if (added.length > 0) {
        await tx.raffleBox.createMany({ data: added.map((number) => ({ raffleId, entryId: entry.id, number })) });
      }
      if (method) {
        await tx.rafflePayment.create({
          data: {
            raffleId,
            entryId: entry.id,
            method,
            amountCents: paidCents,
            payerName,
            receivedOn: parseDateOnlyString(todayDateOnlyString()),
            recordedByUserId: session.userId,
          },
        });
      }

      const parts = [
        ...(added.length > 0 ? [`added ${boxWord(added.length)} ${formatBoxNumbers(added)}`] : []),
        ...(dropped.length > 0 ? [`took away ${boxWord(dropped.length)} ${formatBoxNumbers(dropped)}`] : []),
      ];
      await recordAuditInTransaction(tx, session, {
        action: "raffle.entry.boxes",
        summary: `Changed ${entry.name}'s boxes on “${raffle.name}”: ${parts.join(", ")}`,
        entityType: "RaffleEntry",
        entityId: entry.id,
        details: [
          ...changedFields({
            Boxes: [formatBoxNumbers(before), formatBoxNumbers(after)],
            Owes: [auditMoney(boxesCost(before.length, raffle.priceCents)), auditMoney(boxesCost(after.length, raffle.priceCents))],
          }),
          ...(method ? [{ label: "Paid", from: "—", to: `${auditMoney(paidCents)} ${RAFFLE_METHOD_LABELS[method]}` }] : []),
          ...(method && payerName ? [{ label: "Paid by", from: "—", to: payerName }] : []),
        ],
      });
    });
    revalidateRaffle(raffleId);
  });
}

/**
 * Takes a buyer off the raffle and frees their boxes. Refused while they have
 * money recorded: that money has to be voided or moved to someone else first,
 * so removing a name can never make a payment disappear.
 *
 * The payment check and the delete happen under the raffle lock, which every
 * payment-recording action takes too: a payment for this buyer either landed
 * before the check (and the removal is refused) or waits until the buyer is
 * gone (and is refused as "that buyer isn't on this raffle any more"). It can
 * never be cut loose from its buyer by the delete.
 */
export async function removeEntryAction(formData: FormData): Promise<RaffleFormResult> {
  const { session } = await sellerSession();
  return asResult(async () => {
    const entryId = field(formData, "entryId");
    const found = entryId
      ? await prisma.raffleEntry.findUnique({ where: { id: entryId }, select: { raffleId: true } })
      : null;
    // Already gone (removed from another screen a moment ago): nothing to do.
    if (!found) return;
    const raffleId = found.raffleId;

    const removed = await withLockedRaffle(raffleId, async (tx, raffle) => {
      const entry = await tx.raffleEntry.findFirst({
        where: { id: entryId, raffleId },
        include: { boxes: { select: { number: true }, orderBy: { number: "asc" } }, payments: true },
      });
      if (!entry) return false;
      assertBoardUnlocked(raffle);

      const liveCents = entry.payments.filter((payment) => !payment.voidedAt).reduce((sum, payment) => sum + payment.amountCents, 0);
      if (entry.payments.some((payment) => !payment.voidedAt)) {
        throw new RaffleInputError(
          `${entry.name} has ${auditMoney(liveCents)} in payments recorded. Void those payments or move them to another buyer first.`
        );
      }

      // Their voided payments stay on the page as history; keep the name on
      // them, since deleting the buyer clears entryId (onDelete: SetNull).
      await tx.rafflePayment.updateMany({
        where: { entryId: entry.id, payerName: null },
        data: { payerName: entry.name },
      });
      const { count } = await tx.raffleEntry.deleteMany({ where: { id: entry.id, raffleId } });
      if (count !== 1) throw new RaffleInputError(BUYER_GONE);

      const boxes = entry.boxes.map((box) => box.number);
      await recordAuditInTransaction(tx, session, {
        action: "raffle.entry.remove",
        summary: `Removed ${entry.name} from “${raffle.name}” and freed ${boxWord(boxes.length)} ${formatBoxNumbers(boxes)}`,
        entityType: "RaffleEntry",
        entityId: entry.id,
        details: [
          { label: "Buyer", from: entry.name, to: "—" },
          { label: "Boxes", from: formatBoxNumbers(boxes), to: "—" },
        ],
      });
      return true;
    });
    if (removed) revalidateRaffle(raffleId);
  });
}

function readPaymentAmount(formData: FormData) {
  const amountCents = dollarsToCents(field(formData, "amount"));
  if (amountCents === null || amountCents === 0) throw new RaffleInputError("Enter the amount received (up to $1,000,000).");
  return amountCents;
}

/** The buyer a payment form points at, read under the lock; "" means money nobody has placed yet. */
async function entryForPayment(tx: Tx, raffleId: string, entryId: string) {
  if (!entryId) return null;
  const entry = await tx.raffleEntry.findFirst({ where: { id: entryId, raffleId }, select: { id: true, name: true } });
  if (!entry) throw new RaffleInputError(BUYER_GONE);
  return entry;
}

/**
 * Money received from a buyer. A Raffle Helper can record it for a buyer;
 * money that isn't matched to anyone yet (no buyer chosen) is bookkeeping from
 * the bank statement, which stays with an Admin.
 */
export async function recordPaymentAction(formData: FormData): Promise<RaffleFormResult> {
  const { session, isAdmin } = await sellerSession();
  return asResult(async () => {
    const raffleId = field(formData, "raffleId");
    const entryId = field(formData, "entryId");
    if (!entryId && !isAdmin) throw new Error("Not authorized: admin only.");
    const amountCents = readPaymentAmount(formData);
    const method = methodField(formData, "method");
    const payerName = nameField(formData, "payerName", "The name it came from") || null;
    const note = noteField(formData, "note", "The note") || null;
    if (!entryId && !payerName) throw new RaffleInputError("Enter the name the money came from, so it can be matched to a buyer later.");
    const receivedOn = dateField(formData, "receivedOn") ?? parseDateOnlyString(todayDateOnlyString());

    await withLockedRaffle(raffleId, async (tx, raffle) => {
      // Read under the lock: a buyer removed a moment ago is refused here
      // rather than leaving this payment with nobody on it.
      const entry = await entryForPayment(tx, raffleId, entryId);
      const payment = await tx.rafflePayment.create({
        data: {
          raffleId,
          entryId: entry?.id ?? null,
          method,
          amountCents,
          payerName,
          receivedOn,
          note,
          recordedByUserId: session.userId,
        },
      });

      const methodLabel = RAFFLE_METHOD_LABELS[method];
      await recordAuditInTransaction(tx, session, {
        action: "raffle.payment.add",
        summary: entry
          ? `Recorded a ${auditMoney(amountCents)} ${methodLabel} payment for ${entry.name} on “${raffle.name}”`
          : `Recorded a ${auditMoney(amountCents)} ${methodLabel} payment from ${payerName} on “${raffle.name}”, not yet matched to a buyer`,
        entityType: "RafflePayment",
        entityId: payment.id,
        details: [
          { label: "Amount", from: "—", to: auditMoney(amountCents) },
          { label: "Method", from: "—", to: methodLabel },
          { label: "Received", from: "—", to: auditDate(receivedOn) },
          ...(payerName ? [{ label: "Paid by", from: "—", to: payerName }] : []),
          ...(note ? [{ label: "Note", from: "—", to: note }] : []),
        ],
      });
    });
    revalidateRaffle(raffleId);
  });
}

/** A payment, read under its raffle's lock, with its buyer's name for messages and the audit. */
async function lockedPayment(tx: Tx, raffleId: string, paymentId: string) {
  const payment = await tx.rafflePayment.findFirst({
    where: { id: paymentId, raffleId },
    include: { entry: { select: { name: true } } },
  });
  if (!payment) throw new RaffleInputError(PAYMENT_GONE);
  return payment;
}

function paymentOwner(payment: { entry: { name: string } | null; payerName: string | null }) {
  return payment.entry?.name ?? payment.payerName ?? "an unmatched payer";
}

/**
 * Corrects a payment: its method (cash that turned out to be a Zelle), amount,
 * payer, date, note, or which buyer it belongs to. A changed amount or method
 * clears the "verified" tick, since what was counted no longer matches —
 * decided from the payment as it stands under the lock, so a verification
 * that landed a moment earlier is cleared too.
 *
 * The Edit form carries paymentEditVersion of the values it was filled in
 * with. If another Admin corrected the payment since (another amount, method,
 * buyer, payer, date or note), the save is refused instead of quietly putting
 * the old values back over their correction.
 */
export async function updatePaymentAction(formData: FormData): Promise<RaffleFormResult> {
  const session = await adminSession();
  return asResult(async () => {
    const paymentId = field(formData, "paymentId");
    const entryId = field(formData, "entryId");
    const amountCents = readPaymentAmount(formData);
    const method = methodField(formData, "method");
    const payerName = nameField(formData, "payerName", "The name it came from") || null;
    const note = noteField(formData, "note", "The note") || null;
    const receivedOn = dateField(formData, "receivedOn");
    if (!entryId && !payerName) throw new RaffleInputError("Enter the name the money came from, or choose the buyer it belongs to.");
    const version = field(formData, "version");
    if (!version) throw new RaffleInputError(PAGE_OUT_OF_DATE);
    const raffleId = await raffleIdOfPayment(paymentId);

    await withLockedRaffle(raffleId, async (tx, raffle) => {
      const payment = await lockedPayment(tx, raffleId, paymentId);
      if (payment.voidedAt) throw new RaffleInputError("That payment is voided. Restore it before editing it.");
      if (paymentEditVersion(payment) !== version) {
        throw new RaffleInputError(
          `That payment was changed after this page loaded — it's now ${auditMoney(payment.amountCents)} by ${RAFFLE_METHOD_LABELS[payment.method].toLowerCase()} for ${paymentOwner(payment)}. Nothing was saved — refresh the page and make your change again.`
        );
      }
      const entry = await entryForPayment(tx, raffleId, entryId);

      const unverify = payment.verifiedAt !== null && (amountCents !== payment.amountCents || method !== payment.method);

      // Only while the payment still holds the values just checked (and so
      // the ones the form was filled in with), and isn't voided.
      const { count } = await tx.rafflePayment.updateMany({
        where: {
          id: payment.id,
          raffleId,
          voidedAt: null,
          entryId: payment.entryId,
          amountCents: payment.amountCents,
          method: payment.method,
          payerName: payment.payerName,
          receivedOn: payment.receivedOn,
          note: payment.note,
        },
        data: {
          entryId: entry?.id ?? null,
          amountCents,
          method,
          payerName,
          note,
          receivedOn,
          ...(unverify ? { verifiedAt: null, verifiedByName: null } : {}),
        },
      });
      if (count !== 1) throw new RaffleInputError(PAYMENT_CHANGED);

      const who = entry?.name ?? payment.entry?.name ?? payerName ?? "an unmatched payer";
      await recordAuditInTransaction(tx, session, {
        action: "raffle.payment.update",
        summary: `Corrected a ${auditMoney(payment.amountCents)} payment for ${who} on “${raffle.name}”`,
        entityType: "RafflePayment",
        entityId: payment.id,
        details: changedFields({
          Buyer: [payment.entry?.name ?? "Not matched", entry?.name ?? "Not matched"],
          Amount: [auditMoney(payment.amountCents), auditMoney(amountCents)],
          Method: [RAFFLE_METHOD_LABELS[payment.method], RAFFLE_METHOD_LABELS[method]],
          "Paid by": [payment.payerName, payerName],
          Received: [payment.receivedOn, receivedOn],
          Note: [payment.note, note],
          Verified: [payment.verifiedAt !== null, payment.verifiedAt !== null && !unverify],
        }),
      });
    });
    revalidateRaffle(raffleId);
  });
}

/**
 * Strikes a payment out without deleting it — it stops counting, and stays
 * listed with the reason. An Admin can void any payment; a Raffle Helper only
 * one they recorded themselves that hasn't been verified yet. Restoring a
 * voided payment is the Admin's.
 *
 * A helper's void is decided under the raffle lock, which verifying takes
 * too, and its write repeats the conditions (their own, not verified, not
 * voided): a verification that commits first always wins, and the helper is
 * told so instead of striking out money an Admin has already counted.
 */
export async function voidPaymentAction(formData: FormData): Promise<RaffleFormResult> {
  const { session, isAdmin } = await sellerSession();
  return asResult(async () => {
    const paymentId = field(formData, "paymentId");
    const reason = noteField(formData, "reason", "The reason");
    if (!reason) throw new RaffleInputError("Say why this payment is being voided.");
    const raffleId = await raffleIdOfPayment(paymentId);

    await withLockedRaffle(raffleId, async (tx, raffle) => {
      const payment = await lockedPayment(tx, raffleId, paymentId);
      if (payment.voidedAt) {
        throw new RaffleInputError(
          `That payment was already voided${payment.voidedByName ? ` by ${payment.voidedByName}` : ""}. Refresh to see it.`
        );
      }
      // A Raffle Helper can take back an entry of their own — the wrong buyer
      // marked paid — but not anyone else's, and not once an Admin has verified
      // it: by then the money has been counted against that line.
      if (!isAdmin) {
        if (payment.recordedByUserId !== session.userId) {
          throw new RaffleInputError("You can only void a payment you recorded yourself. Ask an Admin to void this one.");
        }
        if (payment.verifiedAt) {
          throw new RaffleInputError("An Admin has already verified this payment, so only an Admin can void it now.");
        }
      }

      const { count } = await tx.rafflePayment.updateMany({
        where: {
          id: payment.id,
          raffleId,
          voidedAt: null,
          ...(isAdmin ? {} : { recordedByUserId: session.userId, verifiedAt: null }),
        },
        data: { voidedAt: new Date(), voidedByName: session.displayName, voidReason: reason },
      });
      if (count !== 1) throw new RaffleInputError(PAYMENT_CHANGED);

      await recordAuditInTransaction(tx, session, {
        action: "raffle.payment.void",
        summary: `Voided a ${auditMoney(payment.amountCents)} ${RAFFLE_METHOD_LABELS[payment.method]} payment for ${paymentOwner(payment)} on “${raffle.name}”`,
        entityType: "RafflePayment",
        entityId: payment.id,
        details: [
          { label: "Amount", from: auditMoney(payment.amountCents), to: "Voided" },
          { label: "Reason", from: "—", to: reason },
        ],
      });
    });
    revalidateRaffle(raffleId);
  });
}

export async function restorePaymentAction(formData: FormData): Promise<RaffleFormResult> {
  const session = await adminSession();
  return asResult(async () => {
    const paymentId = field(formData, "paymentId");
    const raffleId = await raffleIdOfPayment(paymentId);

    const restored = await withLockedRaffle(raffleId, async (tx, raffle) => {
      const payment = await lockedPayment(tx, raffleId, paymentId);
      // Restored from another screen a moment ago: nothing left to do.
      if (!payment.voidedAt) return false;

      // Back as unverified: whatever was checked before the void no longer vouches for it.
      const { count } = await tx.rafflePayment.updateMany({
        where: { id: payment.id, raffleId, voidedAt: { not: null } },
        data: { voidedAt: null, voidedByName: null, voidReason: null, verifiedAt: null, verifiedByName: null },
      });
      if (count !== 1) throw new RaffleInputError(PAYMENT_CHANGED);

      await recordAuditInTransaction(tx, session, {
        action: "raffle.payment.restore",
        summary: `Restored a voided ${auditMoney(payment.amountCents)} payment for ${paymentOwner(payment)} on “${raffle.name}”`,
        entityType: "RafflePayment",
        entityId: payment.id,
        details: [{ label: "Amount", from: "Voided", to: auditMoney(payment.amountCents) }],
      });
      return true;
    });
    if (restored) revalidateRaffle(raffleId);
  });
}

/** An amount in whole cents as the forms carry it back ("1000"), or null. */
function centsField(formData: FormData, name: string) {
  const raw = field(formData, name);
  return /^\d{1,9}$/.test(raw) ? Number(raw) : null;
}

/**
 * The reconciliation tick: this cash was counted, or this Zelle was found on
 * the bank statement. The Verify button carries the amount and method its row
 * showed, and only a payment still at that amount and method is ticked — if
 * another Admin corrected it in the meantime, what was counted was a
 * different payment, so the tick is refused rather than vouching for money
 * nobody checked. Un-verifying needs no such match.
 */
export async function setPaymentVerifiedAction(formData: FormData): Promise<RaffleFormResult> {
  const session = await adminSession();
  return asResult(async () => {
    const paymentId = field(formData, "paymentId");
    const verified = field(formData, "verified") === "true";
    // What the Verify button's row showed; not needed to un-verify.
    let reviewed: { amountCents: number; method: RaffleMethod } | null = null;
    if (verified) {
      const amountCents = centsField(formData, "amountCents");
      const method = field(formData, "method");
      if (amountCents === null || !isRaffleMethod(method)) throw new RaffleInputError(PAGE_OUT_OF_DATE);
      reviewed = { amountCents, method };
    }
    const raffleId = await raffleIdOfPayment(paymentId);

    const changed = await withLockedRaffle(raffleId, async (tx, raffle) => {
      const payment = await lockedPayment(tx, raffleId, paymentId);
      if (payment.voidedAt) throw new RaffleInputError("That payment was voided a moment ago. Refresh to see it.");
      // Already the way this button wanted it (another Admin got there first).
      if ((payment.verifiedAt !== null) === verified) return false;
      if (reviewed && (payment.amountCents !== reviewed.amountCents || payment.method !== reviewed.method)) {
        throw new RaffleInputError(
          `That payment was changed after this page loaded — it's now ${auditMoney(payment.amountCents)} by ${RAFFLE_METHOD_LABELS[payment.method].toLowerCase()}. Nothing was verified. Refresh, check it again, then verify.`
        );
      }

      const { count } = await tx.rafflePayment.updateMany({
        where: reviewed
          ? { id: payment.id, raffleId, voidedAt: null, verifiedAt: null, ...reviewed }
          : { id: payment.id, raffleId, voidedAt: null, verifiedAt: { not: null } },
        data: reviewed ? { verifiedAt: new Date(), verifiedByName: session.displayName } : { verifiedAt: null, verifiedByName: null },
      });
      if (count !== 1) throw new RaffleInputError(PAYMENT_CHANGED);

      const what = `the ${auditMoney(payment.amountCents)} ${RAFFLE_METHOD_LABELS[payment.method]} payment for ${paymentOwner(payment)}`;
      await recordAuditInTransaction(tx, session, {
        action: verified ? "raffle.payment.verify" : "raffle.payment.unverify",
        summary: verified ? `Verified ${what} on “${raffle.name}”` : `Un-verified ${what} on “${raffle.name}”`,
        entityType: "RafflePayment",
        entityId: payment.id,
        details: [{ label: "Verified", from: verified ? "No" : "Yes", to: verified ? "Yes" : "No" }],
      });
      return true;
    });
    if (changed) revalidateRaffle(raffleId);
  });
}

/** More than any raffle has; a bound on what one Verify All request can name. */
const MAX_REVIEWED_PAYMENTS = 2_000;

/**
 * The payments a Verify All button was drawn for, as "paymentId:amountCents"
 * pairs — exactly the list (and total) the Admin compared their count with.
 */
function readReviewedPayments(formData: FormData) {
  const values = formData.getAll("reviewed");
  if (values.length === 0 || values.length > MAX_REVIEWED_PAYMENTS) throw new RaffleInputError(PAGE_OUT_OF_DATE);
  const reviewed = new Map<string, number>();
  for (const value of values) {
    const match = typeof value === "string" ? /^([A-Za-z0-9_-]{1,64}):(\d{1,9})$/.exec(value) : null;
    if (!match || reviewed.has(match[1])) throw new RaffleInputError(PAGE_OUT_OF_DATE);
    reviewed.set(match[1], Number(match[2]));
  }
  return reviewed;
}

/**
 * Ticks off every unverified payment of one method at once — for when the
 * cash count comes out right. "Right" means it matched the list on the
 * Admin's screen, so that list is what gets verified: the form names each
 * payment with the amount it showed. If any of them has since been voided,
 * corrected, or moved to another method, the count no longer matches what's
 * recorded and nothing is verified — the Admin is told to refresh and
 * recount. A payment recorded after the page loaded wasn't in the count, so
 * it's left for its own Verify button.
 */
export async function verifyAllPaymentsAction(formData: FormData): Promise<RaffleFormResult> {
  const session = await adminSession();
  return asResult(async () => {
    const raffleId = field(formData, "raffleId");
    const method = methodField(formData, "method");
    const reviewed = readReviewedPayments(formData);
    const label = RAFFLE_METHOD_LABELS[method];

    const verifiedAny = await withLockedRaffle(raffleId, async (tx, raffle) => {
      const current = await tx.rafflePayment.findMany({
        where: { raffleId, id: { in: [...reviewed.keys()] } },
        select: {
          id: true,
          amountCents: true,
          method: true,
          verifiedAt: true,
          voidedAt: true,
          payerName: true,
          entry: { select: { name: true } },
        },
      });
      const byId = new Map(current.map((payment) => [payment.id, payment]));
      const changed = [...reviewed].filter(([id, cents]) => {
        const payment = byId.get(id);
        return !payment || payment.voidedAt !== null || payment.method !== method || payment.amountCents !== cents;
      });
      if (changed.length > 0) {
        const one = changed.length === 1;
        // Which ones, as the Admin's list showed them, so they know what to look at.
        const named = changed.slice(0, 3).map(([id, cents]) => {
          const payment = byId.get(id);
          return payment ? `${paymentOwner(payment)}'s ${auditMoney(cents)}` : `a ${auditMoney(cents)} payment`;
        });
        throw new RaffleInputError(
          `${changed.length} of the ${reviewed.size} ${label} payments on your screen ${one ? "was" : "were"} voided or changed after the page loaded (${named.join(", ")}${changed.length > 3 ? " and more" : ""}), so the total you counted no longer matches. Nothing was verified — refresh the page, check the list, and try again.`
        );
      }

      // Any that another Admin ticked a moment ago are already verified.
      const toVerify = current.filter((payment) => payment.verifiedAt === null);
      if (toVerify.length === 0) return false;

      const { count } = await tx.rafflePayment.updateMany({
        where: {
          raffleId,
          method,
          voidedAt: null,
          verifiedAt: null,
          OR: toVerify.map((payment) => ({ id: payment.id, amountCents: payment.amountCents })),
        },
        data: { verifiedAt: new Date(), verifiedByName: session.displayName },
      });
      if (count !== toVerify.length) throw new RaffleInputError(PAYMENT_CHANGED);

      const totalCents = toVerify.reduce((sum, payment) => sum + payment.amountCents, 0);
      await recordAuditInTransaction(tx, session, {
        action: "raffle.payment.verifyAll",
        summary: `Verified all ${toVerify.length} remaining ${label} payments (${auditMoney(totalCents)}) on “${raffle.name}”`,
        entityType: "Raffle",
        entityId: raffleId,
        details: [
          { label: "Payments", from: "—", to: String(toVerify.length) },
          { label: "Total", from: "—", to: auditMoney(totalCents) },
        ],
      });
      return true;
    });
    if (verifiedAny) revalidateRaffle(raffleId);
  });
}

/**
 * Records the drawing. The winning box has to be one somebody holds, and the
 * prize is fixed here from the boxes sold right now — counted under the
 * raffle lock, which every sale takes too, so no sale can land between the
 * count and the freeze.
 */
export async function recordWinnerAction(formData: FormData): Promise<RaffleFormResult> {
  const session = await adminSession();
  return asResult(async () => {
    const raffleId = field(formData, "raffleId");
    const rawBox = field(formData, "winningBox");
    const winningBox = rawBox ? parseCount(rawBox, MAX_RAFFLE_BOXES) : null;
    const typedWinner = nameField(formData, "winnerName", "The winner's name");

    await withLockedRaffle(raffleId, async (tx, raffle) => {
      if (winningBox === null || winningBox < 1 || winningBox > raffle.boxCount) {
        throw new RaffleInputError(`Enter the winning box number, from 1 to ${raffle.boxCount}.`);
      }

      const [box, soldBoxes] = await Promise.all([
        tx.raffleBox.findUnique({
          where: { raffleId_number: { raffleId, number: winningBox } },
          select: { entry: { select: { name: true } } },
        }),
        tx.raffleBox.count({ where: { raffleId } }),
      ]);
      if (!box) throw new RaffleInputError(`Box ${winningBox} wasn't sold, so it can't win. Draw again, or check the number.`);

      const winnerName = typedWinner || box.entry.name;
      // A corrected winner keeps the prize that was already fixed.
      const prizeCents = raffle.prizeCents ?? prizeFor(soldBoxes, raffle);

      await tx.raffle.update({ where: { id: raffleId }, data: { winningBox, winnerName, prizeCents } });

      await recordAuditInTransaction(tx, session, {
        action: "raffle.winner.record",
        summary: `Recorded box ${winningBox} (${winnerName}) as the winner of “${raffle.name}” — prize ${auditMoney(prizeCents)}`,
        entityType: "Raffle",
        entityId: raffleId,
        details: changedFields({
          "Winning box": [raffle.winningBox, winningBox],
          Winner: [raffle.winnerName, winnerName],
          "Box bought by": [null, box.entry.name],
          Prize: [auditMoney(raffle.prizeCents), auditMoney(prizeCents)],
        }),
      });
    });
    revalidateRaffle(raffleId);
  });
}

/** Undoes the drawing record, which also unlocks the board and un-fixes the prize. */
export async function clearWinnerAction(formData: FormData): Promise<RaffleFormResult> {
  const session = await adminSession();
  return asResult(async () => {
    const raffleId = field(formData, "raffleId");
    const cleared = await withLockedRaffle(raffleId, async (tx, raffle) => {
      if (raffle.winningBox === null) return false;

      await tx.raffle.update({
        where: { id: raffleId },
        data: { winningBox: null, winnerName: null, prizeCents: null, prizePaid: false, prizePaidOn: null, prizePaidMethod: null },
      });

      await recordAuditInTransaction(tx, session, {
        action: "raffle.winner.clear",
        summary: `Cleared the recorded winner of “${raffle.name}” (box ${raffle.winningBox}, ${raffle.winnerName})`,
        entityType: "Raffle",
        entityId: raffleId,
        details: changedFields({
          "Winning box": [raffle.winningBox, null],
          Winner: [raffle.winnerName, null],
          Prize: [auditMoney(raffle.prizeCents), null],
          "Prize paid": [raffle.prizePaid, false],
        }),
      });
      return true;
    });
    if (cleared) revalidateRaffle(raffleId);
  });
}

export async function setPrizePaidAction(formData: FormData): Promise<RaffleFormResult> {
  const session = await adminSession();
  return asResult(async () => {
    const raffleId = field(formData, "raffleId");
    const prizePaid = field(formData, "prizePaid") === "true";
    const methodRaw = field(formData, "prizePaidMethod");
    const prizePaidMethod = prizePaid && methodRaw ? methodField(formData, "prizePaidMethod") : null;
    const prizePaidOn = prizePaid ? dateField(formData, "prizePaidOn") : null;

    await withLockedRaffle(raffleId, async (tx, raffle) => {
      if (raffle.winningBox === null) throw new RaffleInputError("Record the winner first.");

      await tx.raffle.update({ where: { id: raffleId }, data: { prizePaid, prizePaidOn, prizePaidMethod } });

      await recordAuditInTransaction(tx, session, {
        action: "raffle.prize.update",
        summary: prizePaid
          ? `Marked the ${auditMoney(raffle.prizeCents)} prize on “${raffle.name}” as paid to ${raffle.winnerName}`
          : `Marked the ${auditMoney(raffle.prizeCents)} prize on “${raffle.name}” as not paid yet`,
        entityType: "Raffle",
        entityId: raffleId,
        details: changedFields({
          "Prize paid": [raffle.prizePaid, prizePaid],
          "Paid on": [raffle.prizePaidOn, prizePaidOn],
          "Paid by": [
            raffle.prizePaidMethod ? RAFFLE_METHOD_LABELS[raffle.prizePaidMethod] : null,
            prizePaidMethod ? RAFFLE_METHOD_LABELS[prizePaidMethod] : null,
          ],
        }),
      });
    });
    revalidateRaffle(raffleId);
  });
}

/**
 * Archives the raffle: it moves to Past Raffles and every change is refused
 * until it's reopened. Under the raffle lock, so a sale or payment still in
 * flight either lands before the close or is refused after it.
 */
export async function closeRaffleAction(formData: FormData): Promise<RaffleFormResult> {
  const session = await adminSession();
  return asResult(async () => {
    const raffleId = field(formData, "raffleId");
    const closed = await withLockedRaffle(
      raffleId,
      async (tx, raffle) => {
        if (raffle.status === "CLOSED") return false;

        await tx.raffle.update({ where: { id: raffleId }, data: { status: "CLOSED", closedAt: new Date() } });

        await recordAuditInTransaction(tx, session, {
          action: "raffle.close",
          summary: `Closed the raffle “${raffle.name}”`,
          entityType: "Raffle",
          entityId: raffleId,
          details: [{ label: "Status", from: "Open", to: "Closed" }],
        });
        return true;
      },
      { allowClosed: true }
    );
    if (closed) revalidateRaffle(raffleId);
  });
}

export async function reopenRaffleAction(formData: FormData): Promise<RaffleFormResult> {
  const session = await adminSession();
  return asResult(async () => {
    const raffleId = field(formData, "raffleId");
    const reopened = await withLockedRaffle(
      raffleId,
      async (tx, raffle) => {
        if (raffle.status === "OPEN") return false;

        await tx.raffle.update({ where: { id: raffleId }, data: { status: "OPEN", closedAt: null } });

        await recordAuditInTransaction(tx, session, {
          action: "raffle.reopen",
          summary: `Reopened the raffle “${raffle.name}”`,
          entityType: "Raffle",
          entityId: raffleId,
          details: [{ label: "Status", from: "Closed", to: "Open" }],
        });
        return true;
      },
      { allowClosed: true }
    );
    if (reopened) revalidateRaffle(raffleId);
  });
}

/**
 * Deletes a raffle and everything in it. Master admin only: these are the
 * pack's permanent fundraising records, and nothing else in the portal can
 * bring one back. The counts in the audit entry are taken under the lock, so
 * they're what was actually deleted.
 */
export async function deleteRaffleAction(formData: FormData): Promise<RaffleFormResult> {
  const session = await adminSession();
  await assertMasterAdmin(session);

  const result = await asResult(async () => {
    const raffleId = field(formData, "raffleId");
    await withLockedRaffle(
      raffleId,
      async (tx, raffle) => {
        const [entries, boxes, payments] = await Promise.all([
          tx.raffleEntry.count({ where: { raffleId } }),
          tx.raffleBox.count({ where: { raffleId } }),
          tx.rafflePayment.count({ where: { raffleId } }),
        ]);

        await tx.raffle.delete({ where: { id: raffleId } });

        await recordAuditInTransaction(tx, session, {
          action: "raffle.delete",
          summary: `Deleted the raffle “${raffle.name}” with its ${entries} buyers, ${boxes} boxes and ${payments} payments`,
          entityType: "Raffle",
          entityId: raffleId,
          details: [
            { label: "Raffle", from: raffle.name, to: "—" },
            { label: "Buyers", from: String(entries), to: "—" },
            { label: "Payments", from: String(payments), to: "—" },
          ],
        });
      },
      { allowClosed: true }
    );
  });
  if (result.error) return result;

  revalidatePath(LIST_PATH);
  redirect(LIST_PATH);
}

/**
 * Gives one login the Raffle Helper permission, or takes it away
 * (enabled = "true" / "false"). Admin only. Limited to the levels that can
 * hold it — an Admin has no use for it, and the shared Trip Viewer login
 * isn't a person.
 */
export async function setRaffleHelperAction(formData: FormData): Promise<RaffleFormResult> {
  const session = await adminSession();
  return asResult(async () => {
    const enabled = field(formData, "enabled") === "true";
    const userId = field(formData, "userId");
    if (!userId) throw new RaffleInputError("Pick who to add.");

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, displayName: true, role: true, raffleHelper: true },
    });
    if (!user) throw new RaffleInputError("That login no longer exists. Refresh and try again.");
    await assertCanMutateUser(session, user);
    if (enabled && !RAFFLE_HELPER_ROLES.includes(user.role)) {
      throw new RaffleInputError(`${user.displayName} is ${ROLE_LABELS[user.role] ?? user.role}, which can't be a raffle helper.`);
    }

    const changed = await raffleTransaction(async (tx) => {
      // Only flips a login that is still the other way (and, when granting,
      // still at a level that can hold it), so two Admins pressing at once
      // record one change, not two.
      const { count } = await tx.user.updateMany({
        where: { id: user.id, raffleHelper: !enabled, ...(enabled ? { role: { in: RAFFLE_HELPER_ROLES } } : {}) },
        data: { raffleHelper: enabled },
      });
      if (count === 0) return false;

      await recordAuditInTransaction(tx, session, {
        action: enabled ? "user.raffleHelper.grant" : "user.raffleHelper.revoke",
        summary: enabled
          ? `Made ${user.displayName} (${user.username}) a 50/50 raffle helper`
          : `Removed ${user.displayName} (${user.username}) as a 50/50 raffle helper`,
        entityType: "User",
        entityId: user.id,
        details: [{ label: "Raffle helper", from: enabled ? "No" : "Yes", to: enabled ? "Yes" : "No" }],
      });
      return true;
    });
    if (changed) revalidatePath(LIST_PATH);
  });
}

/** A raffle record file is a few kilobytes; anything far beyond that isn't one. */
const MAX_IMPORT_BYTES = 512 * 1024;

/**
 * Brings in a raffle that was run before this page existed, from a record
 * file (see src/lib/raffleImport.ts). All of it or none of it.
 */
export async function importRaffleAction(formData: FormData): Promise<RaffleFormResult> {
  const session = await adminSession();
  let raffleId = "";

  const result = await asResult(async () => {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new RaffleInputError("Choose the raffle record file first.");
    if (file.size > MAX_IMPORT_BYTES) throw new RaffleInputError("That file is too large to be a raffle record.");

    const parsed = parseRaffleImport(await file.text());
    if (!parsed.ok) throw new RaffleInputError(parsed.error);
    const record = parsed.raffle;

    const now = new Date();
    // One transaction, so a record never lands with half its boxes. The
    // longer timeout covers a full board's worth of small inserts.
    raffleId = await raffleTransaction(
      async (tx) => {
        // Two imports of the same file at once would both pass a plain
        // "already imported?" check; this lock makes the second wait and
        // then see the first.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`raffle-import:${record.name}`}))`;
        const duplicate = await tx.raffle.findFirst({ where: { name: record.name }, select: { id: true } });
        if (duplicate) {
          throw new RaffleInputError(`There is already a raffle named “${record.name}”. It looks like this record was imported before.`);
        }

        const created = await tx.raffle.create({
          data: {
            name: record.name,
            drawingDate: parseDateOnlyString(record.drawingDate),
            boxCount: record.boxCount,
            priceCents: record.priceCents,
            prizePercent: record.prizePercent,
            notes: record.notes,
            status: record.closed ? "CLOSED" : "OPEN",
            closedAt: record.closed ? now : null,
            ...(record.winner
              ? {
                  winningBox: record.winner.box,
                  winnerName: record.winner.name,
                  prizeCents: record.winner.prizeCents,
                  prizePaid: record.winner.paid,
                  prizePaidOn: parseDateOnlyString(record.winner.paidOn),
                  prizePaidMethod: record.winner.method,
                }
              : {}),
          },
          select: { id: true },
        });
        for (const buyer of record.buyers) {
          const entry = await tx.raffleEntry.create({
            data: { raffleId: created.id, name: buyer.name, notes: buyer.notes },
            select: { id: true },
          });
          await tx.raffleBox.createMany({
            data: buyer.boxes.map((number) => ({ raffleId: created.id, entryId: entry.id, number })),
          });
          if (buyer.payments.length > 0) {
            await tx.rafflePayment.createMany({
              data: buyer.payments.map((payment) => ({
                raffleId: created.id,
                entryId: entry.id,
                method: payment.method,
                amountCents: payment.amountCents,
                payerName: payment.payerName,
                receivedOn: parseDateOnlyString(payment.receivedOn),
                note: payment.note,
                verifiedAt: payment.verified ? now : null,
                verifiedByName: payment.verified ? `${session.displayName} (imported record)` : null,
                recordedByUserId: session.userId,
              })),
            });
          }
        }

        const boxes = record.buyers.reduce((sum, buyer) => sum + buyer.boxes.length, 0);
        const collected = record.buyers.reduce(
          (sum, buyer) => sum + buyer.payments.reduce((paid, payment) => paid + payment.amountCents, 0),
          0
        );
        await recordAuditInTransaction(tx, session, {
          action: "raffle.import",
          summary: `Imported the raffle record “${record.name}” — ${record.buyers.length} buyers, ${boxes} boxes, ${auditMoney(collected)} collected`,
          entityType: "Raffle",
          entityId: created.id,
          details: [
            { label: "Buyers", from: "—", to: String(record.buyers.length) },
            { label: "Boxes sold", from: "—", to: `${boxes} of ${record.boxCount}` },
            { label: "Collected", from: "—", to: auditMoney(collected) },
            ...(record.winner ? [{ label: "Winner", from: "—", to: `Box ${record.winner.box}, ${record.winner.name}` }] : []),
          ],
        });
        return created.id;
      },
      { maxWait: 10_000, timeout: 30_000 }
    );
  });
  if (result.error) {
    // The buyer-name index refusing two of the file's buyers (a spelling the
    // file check treated as different but Postgres doesn't), rather than a
    // buyer added meanwhile.
    return result.error === NAME_TAKEN_MEANWHILE
      ? { error: "Two buyers in this file have the same name. Give each a name that tells them apart, then import again." }
      : result;
  }

  revalidatePath(LIST_PATH);
  redirect(rafflePath(raffleId));
}
