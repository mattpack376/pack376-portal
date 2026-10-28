import "server-only";
import { prisma } from "@/lib/prisma";
import { keepPaymentRecords, type DeletionContext } from "@/lib/paymentRecords";
import { formatCents } from "@/lib/duesData";

/**
 * Deletes a scout and cascades to its Parent rows at the DB level, which
 * bypasses removeParentAction's sessionVersion bump — done here instead so
 * an already-issued parent session can't keep seeing this scout's data for
 * the rest of its 45-day life. Shared by the den roster's Remove action and
 * the admin Users → Scouts screen's Delete button.
 *
 * The scout's dues and event payments cascade away with it, so they're copied
 * into Payment Records first, in the same transaction: the copy and the
 * delete commit together or not at all. Returns what was kept, for the
 * caller's audit entry.
 */
export async function deleteScoutCascade(scoutId: string, context: DeletionContext) {
  const linkedParents = await prisma.parent.findMany({
    where: { scoutId, userId: { not: null } },
    select: { userId: true },
  });
  const linkedUserIds = [...new Set(linkedParents.map((p) => p.userId!))];

  return prisma.$transaction(async (tx) => {
    const kept = await keepPaymentRecords(tx, { scoutIds: [scoutId] }, context);
    await tx.scout.delete({ where: { id: scoutId } });
    for (const userId of linkedUserIds) {
      await tx.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
    }
    return kept;
  });
}

/** " — 3 payments ($45.00) kept in Payment Records" for an audit summary, or "" when none were. */
export function keptPaymentsNote(kept: { count: number; totalCents: number }) {
  if (kept.count === 0) return "";
  const n = kept.count === 1 ? "1 payment" : `${kept.count} payments`;
  return ` — ${n} (${formatCents(kept.totalCents)}) kept in Payment Records`;
}

export type PaymentSummary = { count: number; totalCents: number };

/**
 * What deleting each of these scouts would move into Payment Records — their
 * dues and event payments — in two queries for the whole list rather than one
 * summarizePayments call per row. Counts the same way: both kinds are family
 * money, so every one adds to the total. Scouts with no payments are absent.
 */
export async function paymentSummariesByScout(scoutIds: string[]): Promise<Map<string, PaymentSummary>> {
  const byScout = new Map<string, PaymentSummary>();
  const ids = [...new Set(scoutIds)];
  if (ids.length === 0) return byScout;
  const add = (scoutId: string, count: number, cents: number) => {
    const s = byScout.get(scoutId) ?? { count: 0, totalCents: 0 };
    s.count += count;
    s.totalCents += cents;
    byScout.set(scoutId, s);
  };

  const [dues, eventPayments] = await Promise.all([
    prisma.duesPayment.groupBy({
      by: ["scoutId"],
      where: { scoutId: { in: ids } },
      _count: { _all: true },
      _sum: { amountCents: true },
    }),
    prisma.eventPayment.findMany({
      where: { eventRegistration: { scoutId: { in: ids } } },
      select: { amountCents: true, eventRegistration: { select: { scoutId: true } } },
    }),
  ]);
  for (const d of dues) add(d.scoutId, d._count._all, d._sum.amountCents ?? 0);
  for (const p of eventPayments) add(p.eventRegistration.scoutId, 1, p.amountCents);
  return byScout;
}
