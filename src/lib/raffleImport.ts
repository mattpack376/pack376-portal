import { MAX_RAFFLE_BOXES, buyerNameKey, isRaffleMethod, prizeForSales, type RaffleMethod } from "@/lib/raffleMath";
import { MAX_CENTS, MAX_NAME_LENGTH, MAX_NOTE_LENGTH, multiplyCents } from "@/lib/formValues";
import { isDateOnlyString } from "@/lib/dateOnly";

/*
 * Reads a raffle record file — the way a raffle that was run on paper (or in
 * a chat) before this page existed gets into the portal as a finished record.
 *
 * The file is checked in full before anything is saved: a box given to two
 * buyers, two buyers with the same name, a box number off the board, a date
 * that isn't on the calendar, text or an amount beyond what the forms accept,
 * or a winning box nobody bought stops the import with a message saying which
 * line is wrong, rather than saving most of a raffle (or failing halfway with
 * a database error).
 *
 * Buyers are told apart by name on the raffle pages (see the note at the top
 * of src/lib/actions/raffles.ts), so two people who share a name have to be
 * written into the file with names that differ — a last name or initial.
 *
 * Buyer names and payment details live in that file, never in this repo,
 * which is public.
 */

export const RAFFLE_IMPORT_FORMAT = "pack376-raffle-v1";

export type RaffleImportPayment = {
  method: RaffleMethod;
  amountCents: number;
  payerName: string | null;
  /** YYYY-MM-DD, or null when the date was never written down. */
  receivedOn: string | null;
  note: string | null;
  verified: boolean;
};

export type RaffleImportBuyer = {
  name: string;
  notes: string | null;
  boxes: number[];
  payments: RaffleImportPayment[];
};

export type RaffleImport = {
  name: string;
  drawingDate: string | null;
  boxCount: number;
  priceCents: number;
  prizePercent: number;
  closed: boolean;
  notes: string | null;
  winner: {
    box: number;
    name: string;
    prizeCents: number;
    paid: boolean;
    paidOn: string | null;
    method: RaffleMethod | null;
  } | null;
  buyers: RaffleImportBuyer[];
};

export type RaffleImportResult = { ok: true; raffle: RaffleImport } | { ok: false; error: string };

class ImportError extends Error {}

function fail(message: string): never {
  throw new ImportError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The same limits the raffle forms enforce, so an imported record can be edited on the page afterwards. */
function bounded(value: string, what: string, max: number): string {
  if (value.length > max) fail(`${what} can be at most ${max} characters.`);
  // Postgres can't store a NUL in text; refuse it here rather than mid-import.
  if (value.includes("\u0000")) fail(`${what} can't be saved with an invisible NUL character in it.`);
  return value;
}

function text(value: unknown, what: string, max = MAX_NAME_LENGTH): string {
  if (typeof value !== "string" || !value.trim()) fail(`${what} is missing.`);
  return bounded(value.trim(), what, max);
}

function optionalText(value: unknown, what: string, max: number): string | null {
  return typeof value === "string" && value.trim() ? bounded(value.trim(), what, max) : null;
}

function optionalDate(value: unknown, what: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  // A real calendar date: Date.parse would quietly turn 2026-02-31 into March 3.
  if (typeof value !== "string" || !isDateOnlyString(value)) {
    fail(`${what} should be a real date like 2026-10-10.`);
  }
  return value;
}

function wholeNumber(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fail(`${what} should be a whole number from ${min} to ${max}.`);
  }
  return value;
}

function dollars(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail(`${what} should be a dollar amount above zero.`);
  const cents = Math.round(value * 100);
  if (cents < 1 || cents > MAX_CENTS) fail(`${what} should be a dollar amount from $0.01 to $1,000,000.`);
  return cents;
}

function method(value: unknown, what: string): RaffleMethod {
  const upper = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!isRaffleMethod(upper)) fail(`${what} should be one of CASH, ZELLE, CHECK or OTHER.`);
  return upper;
}

export function parseRaffleImport(source: string): RaffleImportResult {
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    return { ok: false, error: "That file isn't a raffle record — it couldn't be read." };
  }

  try {
    if (!isRecord(data) || data.format !== RAFFLE_IMPORT_FORMAT) {
      fail("That file isn't a Pack 376 raffle record.");
    }

    const name = text(data.name, "The raffle name");
    const boxCount = wholeNumber(data.boxCount, "The number of boxes", 1, MAX_RAFFLE_BOXES);
    const priceCents = dollars(data.priceDollars, "The price per box");
    // Same rule as starting a raffle on the page: a full board fits in one amount.
    if (multiplyCents(boxCount, priceCents) === null) fail("The number of boxes times the price comes to more than $1,000,000.");
    const prizePercent = wholeNumber(data.prizePercent ?? 50, "The prize percentage", 0, 100);

    if (!Array.isArray(data.buyers)) fail("The list of buyers is missing.");
    const holders = new Map<number, string>();
    const names = new Map<string, string>();
    const buyers = data.buyers.map((raw, index): RaffleImportBuyer => {
      if (!isRecord(raw)) fail(`Buyer ${index + 1} couldn't be read.`);
      const buyerName = text(raw.name, `Buyer ${index + 1}'s name`);
      // Compared the way the raffle pages compare names (buyerNameKey).
      const sameName = names.get(buyerNameKey(buyerName));
      if (sameName) {
        fail(`${sameName} and ${buyerName} are listed as two buyers with the same name. Give each a name that tells them apart, like a last name or initial.`);
      }
      names.set(buyerNameKey(buyerName), buyerName);
      if (!Array.isArray(raw.boxes) || raw.boxes.length === 0) fail(`${buyerName} has no boxes listed.`);
      const boxes = raw.boxes.map((box) => wholeNumber(box, `A box number for ${buyerName}`, 1, boxCount));
      for (const box of boxes) {
        const holder = holders.get(box);
        if (holder) fail(`Box ${box} is listed for both ${holder} and ${buyerName}.`);
        holders.set(box, buyerName);
      }
      const rawPayments = raw.payments ?? [];
      if (!Array.isArray(rawPayments)) fail(`${buyerName}'s payments couldn't be read.`);
      const payments = rawPayments.map((payment): RaffleImportPayment => {
        if (!isRecord(payment)) fail(`A payment for ${buyerName} couldn't be read.`);
        return {
          method: method(payment.method, `The payment method for ${buyerName}`),
          amountCents: dollars(payment.amountDollars, `A payment amount for ${buyerName}`),
          payerName: optionalText(payment.payerName, `A payer's name for ${buyerName}`, MAX_NAME_LENGTH),
          receivedOn: optionalDate(payment.receivedOn, `A payment date for ${buyerName}`),
          note: optionalText(payment.note, `A payment note for ${buyerName}`, MAX_NOTE_LENGTH),
          verified: payment.verified === true,
        };
      });
      return {
        name: buyerName,
        notes: optionalText(raw.notes, `The notes for ${buyerName}`, MAX_NOTE_LENGTH),
        boxes: boxes.sort((a, b) => a - b),
        payments,
      };
    });

    let winner: RaffleImport["winner"] = null;
    if (data.winner !== null && data.winner !== undefined) {
      if (!isRecord(data.winner)) fail("The winner couldn't be read.");
      const box = wholeNumber(data.winner.box, "The winning box", 1, boxCount);
      const holder = holders.get(box);
      if (!holder) fail(`The winning box, ${box}, isn't listed for any buyer.`);
      const expected = prizeForSales(holders.size, priceCents, prizePercent);
      const prizeCents =
        data.winner.prizeDollars === undefined || data.winner.prizeDollars === null
          ? expected
          : dollars(data.winner.prizeDollars, "The prize amount");
      winner = {
        box,
        name: optionalText(data.winner.name, "The winner's name", MAX_NAME_LENGTH) ?? holder,
        prizeCents,
        paid: data.winner.paid === true,
        paidOn: optionalDate(data.winner.paidOn, "The date the prize was paid"),
        method:
          data.winner.method === null || data.winner.method === undefined
            ? null
            : method(data.winner.method, "How the prize was paid"),
      };
    }

    return {
      ok: true,
      raffle: {
        name,
        drawingDate: optionalDate(data.drawingDate, "The drawing date"),
        boxCount,
        priceCents,
        prizePercent,
        closed: data.closed === true,
        notes: optionalText(data.notes, "The raffle notes", MAX_NOTE_LENGTH),
        winner,
        buyers,
      },
    };
  } catch (error) {
    if (error instanceof ImportError) return { ok: false, error: error.message };
    throw error;
  }
}
