"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin, assertMasterAdmin } from "@/lib/authorize";
import { recordAudit, changedFields, auditMoney, auditDate } from "@/lib/audit";
import { dollarsToCents } from "@/lib/formValues";
import { parseDateOnlyString, todayDateOnlyString } from "@/lib/dateOnly";
import {
  MAX_RAFFLE_BOXES,
  RAFFLE_METHOD_LABELS,
  formatBoxNumbers,
  isRaffleMethod,
  parseBoxNumbers,
  prizeForSales,
  type RaffleMethod,
} from "@/lib/raffleMath";
import { parseRaffleImport } from "@/lib/raffleImport";

/*
 * Everything that changes a 50/50 raffle. Admin only, start to finish: Junior
 * Admin reads the pages (see requireRafflesViewSession) and changes nothing.
 *
 * Two kinds of action live here. The ones a careful admin can still get wrong
 * — typing a box that's taken, a winning number nobody bought — hand back
 * { error } for the form to show (ActionForm, EditPopover), because a thrown
 * error in production replaces the page with a generic message that says
 * nothing about which box. The one-tap ones (verify, close, reopen) throw like
 * the rest of the portal's actions; they only fail on a tampered or stale
 * request.
 *
 * A closed raffle refuses every change until it's reopened, and box
 * assignments freeze once the winner is recorded: the prize is fixed from the
 * boxes sold at that moment, so the board can't shift underneath it. Money
 * can still be collected after the drawing.
 */

const LIST_PATH = "/portal/admin/raffles";
const rafflePath = (raffleId: string) => `${LIST_PATH}/${raffleId}`;

export type RaffleFormResult = { error?: string };

/** A mistake in what was entered — shown on the form rather than thrown to the error page. */
class RaffleInputError extends Error {}

async function asResult(work: () => Promise<void>): Promise<RaffleFormResult> {
  try {
    await work();
    return {};
  } catch (error) {
    if (error instanceof RaffleInputError) return { error: error.message };
    throw error;
  }
}

async function adminSession() {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);
  return session;
}

function revalidateRaffle(raffleId: string) {
  revalidatePath(LIST_PATH);
  revalidatePath(rafflePath(raffleId));
}

/** The raffle a change is aimed at, refused once it's closed. */
async function openRaffle(raffleId: string) {
  const raffle = raffleId ? await prisma.raffle.findUnique({ where: { id: raffleId } }) : null;
  if (!raffle) throw new Error("Raffle not found.");
  if (raffle.status === "CLOSED") {
    throw new RaffleInputError("This raffle is closed. Reopen it before changing anything.");
  }
  return raffle;
}

type OpenRaffle = Awaited<ReturnType<typeof openRaffle>>;

function assertBoardUnlocked(raffle: OpenRaffle) {
  if (raffle.winningBox !== null) {
    throw new RaffleInputError(
      "The winner is already recorded, so the board is locked. Clear the winner first if a box really needs to change."
    );
  }
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

function field(formData: FormData, name: string) {
  return String(formData.get(name) || "").trim();
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

/** Shared by New Raffle and Edit Raffle. */
function readRaffleTerms(formData: FormData) {
  const name = field(formData, "name");
  if (!name) throw new RaffleInputError("Give the raffle a name.");
  const boxCount = Number(field(formData, "boxCount"));
  if (!Number.isInteger(boxCount) || boxCount < 1 || boxCount > MAX_RAFFLE_BOXES) {
    throw new RaffleInputError(`The number of boxes must be between 1 and ${MAX_RAFFLE_BOXES}.`);
  }
  const priceCents = dollarsToCents(field(formData, "price"));
  if (priceCents === null || priceCents === 0) throw new RaffleInputError("Enter a price per box above $0.");
  const prizePercent = Number(field(formData, "prizePercent"));
  if (!Number.isInteger(prizePercent) || prizePercent < 0 || prizePercent > 100) {
    throw new RaffleInputError("The winner's share must be a whole percentage from 0 to 100.");
  }
  return {
    name,
    boxCount,
    priceCents,
    prizePercent,
    drawingDate: dateField(formData, "drawingDate"),
    notes: field(formData, "notes") || null,
  };
}

export async function createRaffleAction(formData: FormData): Promise<RaffleFormResult> {
  const session = await adminSession();
  let raffleId = "";

  const result = await asResult(async () => {
    const terms = readRaffleTerms(formData);
    const raffle = await prisma.raffle.create({ data: terms });
    raffleId = raffle.id;

    await recordAudit(session, {
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
  });
  if (result.error) return result;

  revalidatePath(LIST_PATH);
  redirect(rafflePath(raffleId));
}

export async function updateRaffleAction(formData: FormData): Promise<RaffleFormResult> {
  const session = await adminSession();
  return asResult(async () => {
    const raffle = await openRaffle(field(formData, "raffleId"));
    const terms = readRaffleTerms(formData);

    const [highestBox, livePayments] = await Promise.all([
      prisma.raffleBox.findFirst({ where: { raffleId: raffle.id }, orderBy: { number: "desc" }, select: { number: true } }),
      prisma.rafflePayment.count({ where: { raffleId: raffle.id, voidedAt: null } }),
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

    await prisma.raffle.update({ where: { id: raffle.id }, data: terms });

    await recordAudit(session, {
      action: "raffle.update",
      summary: `Edited the raffle “${terms.name}”`,
      entityType: "Raffle",
      entityId: raffle.id,
      details: changedFields({
        Name: [raffle.name, terms.name],
        "Drawing date": [raffle.drawingDate, terms.drawingDate],
        Boxes: [raffle.boxCount, terms.boxCount],
        "Price per box": [auditMoney(raffle.priceCents), auditMoney(terms.priceCents)],
        "Winner's share": [`${raffle.prizePercent}%`, `${terms.prizePercent}%`],
        Notes: [raffle.notes, terms.notes],
      }),
    });
    revalidateRaffle(raffle.id);
  });
}

/** Box numbers as typed, checked against the size of the board. */
function readBoxes(raw: string, boxCount: number) {
  const numbers = parseBoxNumbers(raw);
  if (numbers === null) throw new RaffleInputError("Box numbers should be whole numbers separated by commas, like 12, 15, 18.");
  const offBoard = numbers.filter((number) => number > boxCount);
  if (offBoard.length > 0) {
    throw new RaffleInputError(`This board only goes up to ${boxCount} — there is no box ${formatBoxNumbers(offBoard)}.`);
  }
  return numbers;
}

/** Says who already holds any of these boxes, so the message names the buyer rather than just the number. */
async function assertBoxesFree(raffleId: string, numbers: number[], exceptEntryId?: string) {
  const taken = await prisma.raffleBox.findMany({
    where: { raffleId, number: { in: numbers }, ...(exceptEntryId ? { entryId: { not: exceptEntryId } } : {}) },
    select: { number: true, entry: { select: { name: true } } },
    orderBy: { number: "asc" },
  });
  if (taken.length === 0) return;
  const list = taken.map((box) => `${box.number} (${box.entry.name})`).join(", ");
  throw new RaffleInputError(`Already taken: box ${list}. Nothing was saved.`);
}

const TAKEN_MEANWHILE = "One of those boxes was taken a moment ago. Nothing was saved — check the board and try again.";

/**
 * Gives boxes to a buyer — a new one, or more boxes for someone already on
 * this raffle — and, when they paid on the spot, records that payment for the
 * full price of the boxes in the same step.
 */
export async function assignBoxesAction(formData: FormData): Promise<RaffleFormResult> {
  const session = await adminSession();
  return asResult(async () => {
    const raffle = await openRaffle(field(formData, "raffleId"));
    assertBoardUnlocked(raffle);

    const numbers = readBoxes(field(formData, "boxes"), raffle.boxCount);
    if (numbers.length === 0) throw new RaffleInputError("Pick at least one box.");

    // The name decides who gets the boxes: one that's already on this raffle
    // (however it's capitalised) gets more boxes, anything else is a new
    // buyer. The forms say which it will be before the admin saves.
    const newName = field(formData, "name");
    if (!newName) throw new RaffleInputError("Enter the buyer's name.");
    const existing = await prisma.raffleEntry.findFirst({
      where: { raffleId: raffle.id, name: { equals: newName, mode: "insensitive" } },
      select: { id: true, name: true },
    });

    const paid = field(formData, "paid");
    const method = paid ? methodField(formData, "paid") : null;
    const payerName = field(formData, "payerName") || null;
    const amountCents = numbers.length * raffle.priceCents;

    await assertBoxesFree(raffle.id, numbers);

    let buyer: { id: string; name: string };
    try {
      buyer = await prisma.$transaction(async (tx) => {
        const entry = existing ?? (await tx.raffleEntry.create({ data: { raffleId: raffle.id, name: newName }, select: { id: true, name: true } }));
        await tx.raffleBox.createMany({
          data: numbers.map((number) => ({ raffleId: raffle.id, entryId: entry.id, number })),
        });
        if (method) {
          await tx.rafflePayment.create({
            data: {
              raffleId: raffle.id,
              entryId: entry.id,
              method,
              amountCents,
              payerName,
              receivedOn: parseDateOnlyString(todayDateOnlyString()),
              recordedByUserId: session.userId,
            },
          });
        }
        return entry;
      });
    } catch (error) {
      // Two admins selling the same number at once: the unique index refused the second.
      if (isUniqueViolation(error)) throw new RaffleInputError(TAKEN_MEANWHILE);
      throw error;
    }

    const paidText = method ? `, paid ${auditMoney(amountCents)} by ${RAFFLE_METHOD_LABELS[method].toLowerCase()}` : ", not paid yet";
    await recordAudit(session, {
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
    revalidateRaffle(raffle.id);
  });
}

/** A buyer's name, notes and box numbers. Changing the boxes changes what they owe. */
export async function updateEntryAction(formData: FormData): Promise<RaffleFormResult> {
  const session = await adminSession();
  return asResult(async () => {
    const entry = await prisma.raffleEntry.findUnique({
      where: { id: field(formData, "entryId") },
      include: { boxes: { select: { number: true }, orderBy: { number: "asc" } } },
    });
    if (!entry) throw new RaffleInputError("That buyer isn't on this raffle any more. Refresh and try again.");
    const raffle = await openRaffle(entry.raffleId);

    const name = field(formData, "name");
    if (!name) throw new RaffleInputError("Enter the buyer's name.");
    const notes = field(formData, "notes") || null;

    const before = entry.boxes.map((box) => box.number);
    const after = readBoxes(field(formData, "boxes"), raffle.boxCount);
    if (after.length === 0) {
      throw new RaffleInputError("A buyer needs at least one box. To take them off the raffle, use Remove instead.");
    }
    const added = after.filter((number) => !before.includes(number));
    const dropped = before.filter((number) => !after.includes(number));
    if (added.length > 0 || dropped.length > 0) assertBoardUnlocked(raffle);
    if (added.length > 0) await assertBoxesFree(raffle.id, added, entry.id);

    try {
      await prisma.$transaction(async (tx) => {
        await tx.raffleEntry.update({ where: { id: entry.id }, data: { name, notes } });
        if (dropped.length > 0) await tx.raffleBox.deleteMany({ where: { entryId: entry.id, number: { in: dropped } } });
        if (added.length > 0) {
          await tx.raffleBox.createMany({ data: added.map((number) => ({ raffleId: raffle.id, entryId: entry.id, number })) });
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new RaffleInputError(TAKEN_MEANWHILE);
      throw error;
    }

    await recordAudit(session, {
      action: "raffle.entry.update",
      summary: `Edited ${name} on “${raffle.name}”`,
      entityType: "RaffleEntry",
      entityId: entry.id,
      details: changedFields({
        Name: [entry.name, name],
        Boxes: [formatBoxNumbers(before), formatBoxNumbers(after)],
        Owes: [auditMoney(before.length * raffle.priceCents), auditMoney(after.length * raffle.priceCents)],
        Notes: [entry.notes, notes],
      }),
    });
    revalidateRaffle(raffle.id);
  });
}

/**
 * Takes a buyer off the raffle and frees their boxes. Refused while they have
 * money recorded: that money has to be voided or moved to someone else first,
 * so removing a name can never make a payment disappear.
 */
export async function removeEntryAction(formData: FormData): Promise<RaffleFormResult> {
  const session = await adminSession();
  return asResult(async () => {
    const entry = await prisma.raffleEntry.findUnique({
      where: { id: field(formData, "entryId") },
      include: { boxes: { select: { number: true }, orderBy: { number: "asc" } }, payments: true },
    });
    if (!entry) return;
    const raffle = await openRaffle(entry.raffleId);
    assertBoardUnlocked(raffle);

    const liveCents = entry.payments.filter((payment) => !payment.voidedAt).reduce((sum, payment) => sum + payment.amountCents, 0);
    if (liveCents > 0) {
      throw new RaffleInputError(
        `${entry.name} has ${auditMoney(liveCents)} in payments recorded. Void those payments or move them to another buyer first.`
      );
    }

    const boxes = entry.boxes.map((box) => box.number);
    await prisma.$transaction(async (tx) => {
      // Their voided payments stay on the page as history; keep the name on them.
      for (const payment of entry.payments) {
        if (!payment.payerName) await tx.rafflePayment.update({ where: { id: payment.id }, data: { payerName: entry.name } });
      }
      await tx.raffleEntry.delete({ where: { id: entry.id } });
    });

    await recordAudit(session, {
      action: "raffle.entry.remove",
      summary: `Removed ${entry.name} from “${raffle.name}” and freed ${boxWord(boxes.length)} ${formatBoxNumbers(boxes)}`,
      entityType: "RaffleEntry",
      entityId: entry.id,
      details: [
        { label: "Buyer", from: entry.name, to: "—" },
        { label: "Boxes", from: formatBoxNumbers(boxes), to: "—" },
      ],
    });
    revalidateRaffle(raffle.id);
  });
}

/** Resolves the buyer a payment form points at; "" means money nobody has placed yet. */
async function entryForPayment(raffleId: string, entryId: string) {
  if (!entryId) return null;
  const entry = await prisma.raffleEntry.findFirst({ where: { id: entryId, raffleId }, select: { id: true, name: true } });
  if (!entry) throw new RaffleInputError("That buyer isn't on this raffle any more. Refresh and try again.");
  return entry;
}

function readPaymentAmount(formData: FormData) {
  const amountCents = dollarsToCents(field(formData, "amount"));
  if (amountCents === null || amountCents === 0) throw new RaffleInputError("Enter the amount received.");
  return amountCents;
}

export async function recordPaymentAction(formData: FormData): Promise<RaffleFormResult> {
  const session = await adminSession();
  return asResult(async () => {
    const raffle = await openRaffle(field(formData, "raffleId"));
    const entry = await entryForPayment(raffle.id, field(formData, "entryId"));
    const amountCents = readPaymentAmount(formData);
    const method = methodField(formData, "method");
    const payerName = field(formData, "payerName") || null;
    const note = field(formData, "note") || null;
    if (!entry && !payerName) throw new RaffleInputError("Enter the name the money came from, so it can be matched to a buyer later.");
    const receivedOn = dateField(formData, "receivedOn") ?? parseDateOnlyString(todayDateOnlyString());

    const payment = await prisma.rafflePayment.create({
      data: {
        raffleId: raffle.id,
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
    await recordAudit(session, {
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
    revalidateRaffle(raffle.id);
  });
}

/**
 * Corrects a payment: its method (cash that turned out to be a Zelle), amount,
 * payer, date, note, or which buyer it belongs to. A changed amount or method
 * clears the "verified" tick, since what was counted no longer matches.
 */
export async function updatePaymentAction(formData: FormData): Promise<RaffleFormResult> {
  const session = await adminSession();
  return asResult(async () => {
    const payment = await prisma.rafflePayment.findUnique({
      where: { id: field(formData, "paymentId") },
      include: { entry: { select: { name: true } } },
    });
    if (!payment) throw new RaffleInputError("That payment is gone. Refresh and try again.");
    const raffle = await openRaffle(payment.raffleId);
    if (payment.voidedAt) throw new RaffleInputError("That payment is voided. Restore it before editing it.");

    const entry = await entryForPayment(raffle.id, field(formData, "entryId"));
    const amountCents = readPaymentAmount(formData);
    const method = methodField(formData, "method");
    const payerName = field(formData, "payerName") || null;
    const note = field(formData, "note") || null;
    const receivedOn = dateField(formData, "receivedOn");
    if (!entry && !payerName) throw new RaffleInputError("Enter the name the money came from, or choose the buyer it belongs to.");

    const unverify = payment.verifiedAt !== null && (amountCents !== payment.amountCents || method !== payment.method);

    await prisma.rafflePayment.update({
      where: { id: payment.id },
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

    const who = entry?.name ?? payment.entry?.name ?? payerName ?? "an unmatched payer";
    await recordAudit(session, {
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
    revalidateRaffle(raffle.id);
  });
}

/** Strikes a payment out without deleting it — it stops counting, and stays listed with the reason. */
export async function voidPaymentAction(formData: FormData): Promise<RaffleFormResult> {
  const session = await adminSession();
  return asResult(async () => {
    const payment = await prisma.rafflePayment.findUnique({
      where: { id: field(formData, "paymentId") },
      include: { entry: { select: { name: true } } },
    });
    if (!payment || payment.voidedAt) return;
    const raffle = await openRaffle(payment.raffleId);
    const reason = field(formData, "reason");
    if (!reason) throw new RaffleInputError("Say why this payment is being voided.");

    await prisma.rafflePayment.update({
      where: { id: payment.id },
      data: { voidedAt: new Date(), voidedByName: session.displayName, voidReason: reason },
    });

    await recordAudit(session, {
      action: "raffle.payment.void",
      summary: `Voided a ${auditMoney(payment.amountCents)} ${RAFFLE_METHOD_LABELS[payment.method]} payment for ${payment.entry?.name ?? payment.payerName ?? "an unmatched payer"} on “${raffle.name}”`,
      entityType: "RafflePayment",
      entityId: payment.id,
      details: [
        { label: "Amount", from: auditMoney(payment.amountCents), to: "Voided" },
        { label: "Reason", from: "—", to: reason },
      ],
    });
    revalidateRaffle(raffle.id);
  });
}

export async function restorePaymentAction(formData: FormData) {
  const session = await adminSession();
  const payment = await prisma.rafflePayment.findUnique({
    where: { id: field(formData, "paymentId") },
    include: { entry: { select: { name: true } } },
  });
  if (!payment || !payment.voidedAt) return;
  const raffle = await openRaffle(payment.raffleId);

  // Back as unverified: whatever was checked before the void no longer vouches for it.
  await prisma.rafflePayment.update({
    where: { id: payment.id },
    data: { voidedAt: null, voidedByName: null, voidReason: null, verifiedAt: null, verifiedByName: null },
  });

  await recordAudit(session, {
    action: "raffle.payment.restore",
    summary: `Restored a voided ${auditMoney(payment.amountCents)} payment for ${payment.entry?.name ?? payment.payerName ?? "an unmatched payer"} on “${raffle.name}”`,
    entityType: "RafflePayment",
    entityId: payment.id,
    details: [{ label: "Amount", from: "Voided", to: auditMoney(payment.amountCents) }],
  });
  revalidateRaffle(raffle.id);
}

/** The reconciliation tick: this cash was counted, or this Zelle was found on the bank statement. */
export async function setPaymentVerifiedAction(formData: FormData) {
  const session = await adminSession();
  const verified = field(formData, "verified") === "true";
  const payment = await prisma.rafflePayment.findUnique({
    where: { id: field(formData, "paymentId") },
    include: { entry: { select: { name: true } } },
  });
  if (!payment || payment.voidedAt) return;
  const raffle = await openRaffle(payment.raffleId);
  if ((payment.verifiedAt !== null) === verified) return;

  await prisma.rafflePayment.update({
    where: { id: payment.id },
    data: verified ? { verifiedAt: new Date(), verifiedByName: session.displayName } : { verifiedAt: null, verifiedByName: null },
  });

  const what = `the ${auditMoney(payment.amountCents)} ${RAFFLE_METHOD_LABELS[payment.method]} payment for ${payment.entry?.name ?? payment.payerName ?? "an unmatched payer"}`;
  await recordAudit(session, {
    action: verified ? "raffle.payment.verify" : "raffle.payment.unverify",
    summary: verified ? `Verified ${what} on “${raffle.name}”` : `Un-verified ${what} on “${raffle.name}”`,
    entityType: "RafflePayment",
    entityId: payment.id,
    details: [{ label: "Verified", from: verified ? "No" : "Yes", to: verified ? "Yes" : "No" }],
  });
  revalidateRaffle(raffle.id);
}

/** Ticks off every unverified payment of one method at once — for when the cash count comes out right. */
export async function verifyAllPaymentsAction(formData: FormData) {
  const session = await adminSession();
  const raffle = await openRaffle(field(formData, "raffleId"));
  const method = methodField(formData, "method");

  const pending = await prisma.rafflePayment.findMany({
    where: { raffleId: raffle.id, method, voidedAt: null, verifiedAt: null },
    select: { id: true, amountCents: true },
  });
  if (pending.length === 0) return;

  await prisma.rafflePayment.updateMany({
    where: { id: { in: pending.map((payment) => payment.id) } },
    data: { verifiedAt: new Date(), verifiedByName: session.displayName },
  });

  const totalCents = pending.reduce((sum, payment) => sum + payment.amountCents, 0);
  await recordAudit(session, {
    action: "raffle.payment.verifyAll",
    summary: `Verified all ${pending.length} remaining ${RAFFLE_METHOD_LABELS[method]} payments (${auditMoney(totalCents)}) on “${raffle.name}”`,
    entityType: "Raffle",
    entityId: raffle.id,
    details: [
      { label: "Payments", from: "—", to: String(pending.length) },
      { label: "Total", from: "—", to: auditMoney(totalCents) },
    ],
  });
  revalidateRaffle(raffle.id);
}

/**
 * Records the drawing. The winning box has to be one somebody holds, and the
 * prize is fixed here from the boxes sold right now.
 */
export async function recordWinnerAction(formData: FormData): Promise<RaffleFormResult> {
  const session = await adminSession();
  return asResult(async () => {
    const raffle = await openRaffle(field(formData, "raffleId"));
    const winningBox = Number(field(formData, "winningBox"));
    if (!Number.isInteger(winningBox) || winningBox < 1 || winningBox > raffle.boxCount) {
      throw new RaffleInputError(`Enter the winning box number, from 1 to ${raffle.boxCount}.`);
    }

    const [box, soldBoxes] = await Promise.all([
      prisma.raffleBox.findUnique({
        where: { raffleId_number: { raffleId: raffle.id, number: winningBox } },
        select: { entry: { select: { name: true } } },
      }),
      prisma.raffleBox.count({ where: { raffleId: raffle.id } }),
    ]);
    if (!box) throw new RaffleInputError(`Box ${winningBox} wasn't sold, so it can't win. Draw again, or check the number.`);

    const winnerName = field(formData, "winnerName") || box.entry.name;
    // A corrected winner keeps the prize that was already fixed.
    const prizeCents = raffle.prizeCents ?? prizeForSales(soldBoxes, raffle.priceCents, raffle.prizePercent);

    await prisma.raffle.update({ where: { id: raffle.id }, data: { winningBox, winnerName, prizeCents } });

    await recordAudit(session, {
      action: "raffle.winner.record",
      summary: `Recorded box ${winningBox} (${winnerName}) as the winner of “${raffle.name}” — prize ${auditMoney(prizeCents)}`,
      entityType: "Raffle",
      entityId: raffle.id,
      details: changedFields({
        "Winning box": [raffle.winningBox, winningBox],
        Winner: [raffle.winnerName, winnerName],
        "Box bought by": [null, box.entry.name],
        Prize: [auditMoney(raffle.prizeCents), auditMoney(prizeCents)],
      }),
    });
    revalidateRaffle(raffle.id);
  });
}

/** Undoes the drawing record, which also unlocks the board and un-fixes the prize. */
export async function clearWinnerAction(formData: FormData) {
  const session = await adminSession();
  const raffle = await openRaffle(field(formData, "raffleId"));
  if (raffle.winningBox === null) return;

  await prisma.raffle.update({
    where: { id: raffle.id },
    data: { winningBox: null, winnerName: null, prizeCents: null, prizePaid: false, prizePaidOn: null, prizePaidMethod: null },
  });

  await recordAudit(session, {
    action: "raffle.winner.clear",
    summary: `Cleared the recorded winner of “${raffle.name}” (box ${raffle.winningBox}, ${raffle.winnerName})`,
    entityType: "Raffle",
    entityId: raffle.id,
    details: changedFields({
      "Winning box": [raffle.winningBox, null],
      Winner: [raffle.winnerName, null],
      Prize: [auditMoney(raffle.prizeCents), null],
      "Prize paid": [raffle.prizePaid, false],
    }),
  });
  revalidateRaffle(raffle.id);
}

export async function setPrizePaidAction(formData: FormData): Promise<RaffleFormResult> {
  const session = await adminSession();
  return asResult(async () => {
    const raffle = await openRaffle(field(formData, "raffleId"));
    if (raffle.winningBox === null) throw new RaffleInputError("Record the winner first.");

    const prizePaid = field(formData, "prizePaid") === "true";
    const methodRaw = field(formData, "prizePaidMethod");
    const prizePaidMethod = prizePaid && methodRaw ? methodField(formData, "prizePaidMethod") : null;
    const prizePaidOn = prizePaid ? dateField(formData, "prizePaidOn") : null;

    await prisma.raffle.update({ where: { id: raffle.id }, data: { prizePaid, prizePaidOn, prizePaidMethod } });

    await recordAudit(session, {
      action: "raffle.prize.update",
      summary: prizePaid
        ? `Marked the ${auditMoney(raffle.prizeCents)} prize on “${raffle.name}” as paid to ${raffle.winnerName}`
        : `Marked the ${auditMoney(raffle.prizeCents)} prize on “${raffle.name}” as not paid yet`,
      entityType: "Raffle",
      entityId: raffle.id,
      details: changedFields({
        "Prize paid": [raffle.prizePaid, prizePaid],
        "Paid on": [raffle.prizePaidOn, prizePaidOn],
        "Paid by": [
          raffle.prizePaidMethod ? RAFFLE_METHOD_LABELS[raffle.prizePaidMethod] : null,
          prizePaidMethod ? RAFFLE_METHOD_LABELS[prizePaidMethod] : null,
        ],
      }),
    });
    revalidateRaffle(raffle.id);
  });
}

/** Archives the raffle: it moves to Past Raffles and every change is refused until it's reopened. */
export async function closeRaffleAction(formData: FormData) {
  const session = await adminSession();
  const raffle = await openRaffle(field(formData, "raffleId"));

  await prisma.raffle.update({ where: { id: raffle.id }, data: { status: "CLOSED", closedAt: new Date() } });

  await recordAudit(session, {
    action: "raffle.close",
    summary: `Closed the raffle “${raffle.name}”`,
    entityType: "Raffle",
    entityId: raffle.id,
    details: [{ label: "Status", from: "Open", to: "Closed" }],
  });
  revalidateRaffle(raffle.id);
}

export async function reopenRaffleAction(formData: FormData) {
  const session = await adminSession();
  const raffle = await prisma.raffle.findUnique({ where: { id: field(formData, "raffleId") } });
  if (!raffle) throw new Error("Raffle not found.");
  if (raffle.status === "OPEN") return;

  await prisma.raffle.update({ where: { id: raffle.id }, data: { status: "OPEN", closedAt: null } });

  await recordAudit(session, {
    action: "raffle.reopen",
    summary: `Reopened the raffle “${raffle.name}”`,
    entityType: "Raffle",
    entityId: raffle.id,
    details: [{ label: "Status", from: "Closed", to: "Open" }],
  });
  revalidateRaffle(raffle.id);
}

/**
 * Deletes a raffle and everything in it. Master admin only: these are the
 * pack's permanent fundraising records, and nothing else in the portal can
 * bring one back.
 */
export async function deleteRaffleAction(formData: FormData) {
  const session = await adminSession();
  await assertMasterAdmin(session);

  const raffle = await prisma.raffle.findUnique({
    where: { id: field(formData, "raffleId") },
    include: { _count: { select: { entries: true, boxes: true, payments: true } } },
  });
  if (!raffle) throw new Error("Raffle not found.");

  await prisma.raffle.delete({ where: { id: raffle.id } });

  await recordAudit(session, {
    action: "raffle.delete",
    summary: `Deleted the raffle “${raffle.name}” with its ${raffle._count.entries} buyers, ${raffle._count.boxes} boxes and ${raffle._count.payments} payments`,
    entityType: "Raffle",
    entityId: raffle.id,
    details: [
      { label: "Raffle", from: raffle.name, to: "—" },
      { label: "Buyers", from: String(raffle._count.entries), to: "—" },
      { label: "Payments", from: String(raffle._count.payments), to: "—" },
    ],
  });
  revalidatePath(LIST_PATH);
  redirect(LIST_PATH);
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

    const duplicate = await prisma.raffle.findFirst({ where: { name: record.name }, select: { id: true } });
    if (duplicate) throw new RaffleInputError(`There is already a raffle named “${record.name}”. It looks like this record was imported before.`);

    const now = new Date();
    // One transaction, so a record never lands with half its boxes. The
    // longer timeout covers a full board's worth of small inserts.
    const raffle = await prisma.$transaction(
      async (tx) => {
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
        return created;
      },
      { maxWait: 10_000, timeout: 30_000 }
    );
    raffleId = raffle.id;

    const boxes = record.buyers.reduce((sum, buyer) => sum + buyer.boxes.length, 0);
    const collected = record.buyers.reduce(
      (sum, buyer) => sum + buyer.payments.reduce((paid, payment) => paid + payment.amountCents, 0),
      0
    );
    await recordAudit(session, {
      action: "raffle.import",
      summary: `Imported the raffle record “${record.name}” — ${record.buyers.length} buyers, ${boxes} boxes, ${auditMoney(collected)} collected`,
      entityType: "Raffle",
      entityId: raffle.id,
      details: [
        { label: "Buyers", from: "—", to: String(record.buyers.length) },
        { label: "Boxes sold", from: "—", to: `${boxes} of ${record.boxCount}` },
        { label: "Collected", from: "—", to: auditMoney(collected) },
        ...(record.winner ? [{ label: "Winner", from: "—", to: `Box ${record.winner.box}, ${record.winner.name}` }] : []),
      ],
    });
  });
  if (result.error) return result;

  revalidatePath(LIST_PATH);
  redirect(rafflePath(raffleId));
}
