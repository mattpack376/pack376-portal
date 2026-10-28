import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { SessionPayload } from "@/lib/session";
import { formatCents } from "@/lib/duesData";
import { formatDateOnly, toDateOnlyString } from "@/lib/dateOnly";
import { denDisplayName } from "@/lib/rankConfig";

/**
 * Payment records outlive whatever they were attached to.
 *
 * Deleting a scout, an event, a guest group, a trip registration, a raffle,
 * or a single payment or trip expense would otherwise take the money record
 * with it (the database cascades). Every delete path that can remove a
 * payment calls keepPaymentRecords inside its transaction, before the delete:
 * it copies each payment into PaymentRecord with who paid, what for, and who
 * deleted it and why. Admins review those at /portal/admin/payment-records
 * and mark each one refunded, kept by the pack, or entered by mistake.
 *
 * BEFORE DELETE triggers on every payment table (migration
 * 20261028120000_payment_records) are the safety net: a payment deleted by a
 * path that never called this is still copied, with less context. A row
 * this function wrote first is left alone there.
 *
 * Delete buttons warn first: summarizePayments + paymentDeletionWarning give
 * the sentence to add to the confirm prompt.
 */

/** What a delete is about to remove, as far as payments go. */
export type PaymentTarget =
  /** Deleting scouts (one, or a whole season): their dues and event payments. */
  | { scoutIds: string[] }
  /** Deleting an event: its scouts' and guest groups' payments. */
  | { eventId: string }
  | { eventRegistrationId: string }
  | { eventGuestGroupId: string }
  | { tripRegistrationId: string }
  /** Deleting a raffle: every payment on it, voided ones included. */
  | { raffleId: string }
  | { duesPaymentId: string }
  | { eventPaymentId: string }
  | { guestGroupPaymentId: string }
  | { tripPaymentId: string }
  | { tripExpenseId: string };

export type DeletionContext = {
  session: SessionPayload;
  /** Short and specific, e.g. `Event "Pinewood Derby" deleted`. */
  reason: string;
};

type Db = Prisma.TransactionClient | typeof prisma;

const scoutName = (s: { firstName: string; lastName: string }) => `${s.firstName} ${s.lastName}`.trim();
const dateLabel = (d: Date) => formatDateOnly(toDateOnlyString(d));
const userName = (u: { displayName: string | null; username: string } | null) =>
  u ? u.displayName || u.username : null;
const recordedBy = { select: { displayName: true, username: true } } as const;

type RecordRow = Prisma.PaymentRecordCreateManyInput;

function dueScoutWhere(target: PaymentTarget): Prisma.DuesPaymentWhereInput | null {
  if ("scoutIds" in target) return { scoutId: { in: target.scoutIds } };
  if ("duesPaymentId" in target) return { id: target.duesPaymentId };
  return null;
}

function eventPaymentWhere(target: PaymentTarget): Prisma.EventPaymentWhereInput | null {
  if ("scoutIds" in target) return { eventRegistration: { scoutId: { in: target.scoutIds } } };
  if ("eventId" in target) return { eventRegistration: { eventId: target.eventId } };
  if ("eventRegistrationId" in target) return { eventRegistrationId: target.eventRegistrationId };
  if ("eventPaymentId" in target) return { id: target.eventPaymentId };
  return null;
}

function guestGroupPaymentWhere(target: PaymentTarget): Prisma.EventGuestGroupPaymentWhereInput | null {
  if ("eventId" in target) return { eventGuestGroup: { eventId: target.eventId } };
  if ("eventGuestGroupId" in target) return { eventGuestGroupId: target.eventGuestGroupId };
  if ("guestGroupPaymentId" in target) return { id: target.guestGroupPaymentId };
  return null;
}

function tripPaymentWhere(target: PaymentTarget): Prisma.TripPaymentWhereInput | null {
  if ("tripRegistrationId" in target) return { tripRegistrationId: target.tripRegistrationId };
  if ("tripPaymentId" in target) return { id: target.tripPaymentId };
  return null;
}

function rafflePaymentWhere(target: PaymentTarget): Prisma.RafflePaymentWhereInput | null {
  if ("raffleId" in target) return { raffleId: target.raffleId };
  return null;
}

function tripExpenseWhere(target: PaymentTarget): Prisma.TripExpenseWhereInput | null {
  if ("tripExpenseId" in target) return { id: target.tripExpenseId };
  return null;
}

async function recordsFor(db: Db, target: PaymentTarget): Promise<Omit<RecordRow, "deletionReason">[]> {
  const rows: Omit<RecordRow, "deletionReason">[] = [];

  const duesWhere = dueScoutWhere(target);
  if (duesWhere) {
    const dues = await db.duesPayment.findMany({
      where: duesWhere,
      include: { scout: { include: { den: true } }, recordedByUser: recordedBy },
    });
    for (const p of dues) {
      const den = denDisplayName(p.scout.den.rank, p.scout.den.scoutingYear, p.scout.den.label);
      rows.push({
        kind: "DUES",
        originalId: p.id,
        amountCents: p.amountCents,
        paidOn: p.paidOn,
        paidBy: scoutName(p.scout),
        paidFor: `Dues — ${scoutName(p.scout)} (${den})`,
        note: p.note,
        recordedByName: userName(p.recordedByUser),
        originalCreatedAt: p.createdAt,
        details: { scoutId: p.scoutId, den, scoutingYear: p.scout.den.scoutingYear },
      });
    }
  }

  const eventWhere = eventPaymentWhere(target);
  if (eventWhere) {
    const payments = await db.eventPayment.findMany({
      where: eventWhere,
      include: { eventRegistration: { include: { event: true, scout: true } }, recordedByUser: recordedBy },
    });
    for (const p of payments) {
      const { event, scout } = p.eventRegistration;
      rows.push({
        kind: "EVENT",
        originalId: p.id,
        amountCents: p.amountCents,
        paidOn: p.paidOn,
        paidBy: scoutName(scout),
        paidFor: `${event.title} (${dateLabel(event.eventDate)}) — ${scoutName(scout)}`,
        note: p.note,
        recordedByName: userName(p.recordedByUser),
        originalCreatedAt: p.createdAt,
        details: {
          eventId: event.id,
          eventRegistrationId: p.eventRegistrationId,
          scoutId: scout.id,
          amountOwedCents: p.eventRegistration.amountOwedCents,
        },
      });
    }
  }

  const guestWhere = guestGroupPaymentWhere(target);
  if (guestWhere) {
    const payments = await db.eventGuestGroupPayment.findMany({
      where: guestWhere,
      include: { eventGuestGroup: { include: { event: true } }, recordedByUser: recordedBy },
    });
    for (const p of payments) {
      const group = p.eventGuestGroup;
      rows.push({
        kind: "GUEST_GROUP",
        originalId: p.id,
        amountCents: p.amountCents,
        paidOn: p.paidOn,
        paidBy: group.familyName,
        paidFor: `${group.event.title} (${dateLabel(group.event.eventDate)}) — guests: ${group.familyName}`,
        note: p.note,
        recordedByName: userName(p.recordedByUser),
        originalCreatedAt: p.createdAt,
        details: {
          eventId: group.eventId,
          eventGuestGroupId: group.id,
          adultCount: group.adultCount,
          childCount: group.childCount,
          amountOwedCents: group.amountOwedCents,
        },
      });
    }
  }

  const tripWhere = tripPaymentWhere(target);
  if (tripWhere) {
    const payments = await db.tripPayment.findMany({
      where: tripWhere,
      include: { tripRegistration: { include: { tripPage: true } }, recordedByUser: recordedBy },
    });
    for (const p of payments) {
      const reg = p.tripRegistration;
      rows.push({
        kind: "TRIP",
        originalId: p.id,
        amountCents: p.amountCents,
        paidOn: p.paidOn,
        paidBy: reg.familyName,
        paidFor: `${reg.tripPage.title} — ${reg.familyName}`,
        note: p.note,
        recordedByName: userName(p.recordedByUser),
        originalCreatedAt: p.createdAt,
        details: {
          tripPageId: reg.tripPageId,
          tripRegistrationId: reg.id,
          contactEmail: reg.contactEmail,
          contactPhone: reg.contactPhone,
          amountOwedCents: reg.amountOwedCents,
        },
      });
    }
  }

  const raffleWhere = rafflePaymentWhere(target);
  if (raffleWhere) {
    const payments = await db.rafflePayment.findMany({
      where: raffleWhere,
      include: { raffle: true, entry: true, recordedByUser: recordedBy },
    });
    for (const p of payments) {
      const voided = p.voidedAt !== null;
      rows.push({
        kind: "RAFFLE",
        originalId: p.id,
        amountCents: p.amountCents,
        paidOn: p.receivedOn,
        method: p.method,
        paidBy: p.payerName || p.entry?.name || null,
        paidFor: `Raffle: ${p.raffle.name}${p.entry ? ` — ${p.entry.name}` : ""}`,
        note: p.note,
        wasVoided: voided,
        voidReason: p.voidReason,
        recordedByName: userName(p.recordedByUser),
        originalCreatedAt: p.createdAt,
        status: voided ? "NOT_APPLICABLE" : "NEEDS_DECISION",
        details: {
          raffleId: p.raffleId,
          entryId: p.entryId,
          buyer: p.entry?.name ?? null,
          verifiedByName: p.verifiedByName,
          voidedByName: p.voidedByName,
        },
      });
    }
  }

  const expenseWhere = tripExpenseWhere(target);
  if (expenseWhere) {
    const expenses = await db.tripExpense.findMany({
      where: expenseWhere,
      include: { tripPage: true, recordedByUser: recordedBy },
    });
    for (const e of expenses) {
      rows.push({
        kind: "TRIP_EXPENSE",
        originalId: e.id,
        amountCents: e.amountCents,
        paidOn: e.spentOn,
        paidBy: e.paidBy,
        paidFor: `${e.tripPage.title} — ${e.isCredit ? "vendor refund/credit" : "expense"}: ${e.description}`,
        isCredit: e.isCredit,
        recordedByName: userName(e.recordedByUser),
        originalCreatedAt: e.createdAt,
        status: "NOT_APPLICABLE",
        details: { tripPageId: e.tripPageId },
      });
    }
  }

  return rows;
}

/**
 * Copies every payment the coming delete will remove into PaymentRecord. Call
 * it inside the delete's own transaction, immediately before the delete, so
 * the copy and the delete commit (or fail) together. Also tells the database's
 * safety-net triggers who is deleting and why, for anything this didn't see
 * (a payment added between this read and the delete). Returns how many were
 * kept and how much money they were (voided raffle payments and trip
 * expenses aren't counted as family money).
 */
export async function keepPaymentRecords(
  tx: Prisma.TransactionClient,
  target: PaymentTarget,
  context: DeletionContext,
): Promise<{ count: number; totalCents: number }> {
  const actor = await tx.user.findUnique({
    where: { id: context.session.userId },
    select: { displayName: true, username: true },
  });
  const deletedByName = userName(actor) ?? context.session.displayName ?? null;
  // Transaction-local (third argument true): gone when this transaction ends.
  await tx.$executeRaw`SELECT set_config('pack376.deletion_reason', ${context.reason}, true),
    set_config('pack376.deleted_by_user_id', ${context.session.userId}, true),
    set_config('pack376.deleted_by_name', ${deletedByName ?? ""}, true)`;

  const rows = await recordsFor(tx, target);
  if (rows.length > 0) {
    await tx.paymentRecord.createMany({
      data: rows.map((row) => ({
        ...row,
        deletionReason: context.reason,
        deletedByUserId: context.session.userId,
        deletedByName,
        capturedBy: "app",
      })),
      skipDuplicates: true,
    });
  }
  return summarize(rows);
}

function summarize(rows: { amountCents: number; kind: string; wasVoided?: boolean | null }[]) {
  const money = rows.filter((r) => r.kind !== "TRIP_EXPENSE" && !r.wasVoided);
  return { count: rows.length, totalCents: money.reduce((sum, r) => sum + r.amountCents, 0) };
}

/** Tables whose single rows have their own Delete button. */
type SinglePaymentTable = "DuesPayment" | "EventPayment" | "EventGuestGroupPayment" | "TripPayment" | "TripExpense";

/**
 * For deleting one payment (or trip expense): locks its row for the rest of
 * the transaction and says whether it still exists. Call it first in the
 * delete's transaction and stop when it returns false. Two clicks on Delete
 * (or a payment and its registration deleted at once) then queue on the lock,
 * and the second finds the row gone and does nothing, instead of failing on a
 * row that vanished between its read and its delete.
 */
export async function lockPaymentRowForDelete(
  tx: Prisma.TransactionClient,
  table: SinglePaymentTable,
  id: string,
): Promise<boolean> {
  // The table name is one of the fixed literals above, never user input.
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "${table}" WHERE id = $1 FOR UPDATE`, id);
  return rows.length > 0;
}

/** How many payments a delete would remove, and their total — for the warning before it. */
export async function summarizePayments(target: PaymentTarget, db: Db = prisma) {
  return summarize(await recordsFor(db, target));
}

/**
 * The sentence a Delete button's confirm prompt adds when payments are
 * attached, or "" when there are none. Starts with a space so it can be
 * appended to the existing prompt.
 */
export function paymentDeletionWarning(summary: { count: number; totalCents: number }): string {
  if (summary.count === 0) return "";
  const n = summary.count === 1 ? "1 payment" : `${summary.count} payments`;
  const total = summary.totalCents > 0 ? ` totaling ${formatCents(summary.totalCents)}` : "";
  return (
    ` ⚠ This has ${n}${total} attached. The payment records will be kept under Admin → Payment Records,` +
    " where you can mark them refunded or kept by the pack."
  );
}
