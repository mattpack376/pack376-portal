import "server-only";
import { prisma } from "@/lib/prisma";
import { summarizeRaffle, type RaffleSummary } from "@/lib/raffleMath";
import { RAFFLE_HELPER_ROLES } from "@/lib/authorize";

const NAME_SUGGESTION_LIMIT = 500;

function byName<T extends { name: string }>(a: T, b: T) {
  return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
}

/** Every raffle with its totals, for the list page: open ones first, then newest drawing first. */
export async function getRaffles() {
  const raffles = await prisma.raffle.findMany({
    include: {
      entries: { select: { id: true, boxes: { select: { number: true } } } },
      payments: { select: { entryId: true, method: true, amountCents: true, verifiedAt: true, voidedAt: true } },
    },
  });

  return raffles
    .map(({ entries, payments, ...raffle }) => ({
      ...raffle,
      buyerCount: entries.length,
      summary: summarizeRaffle(
        raffle,
        entries.map((entry) => ({ id: entry.id, boxNumbers: entry.boxes.map((box) => box.number) })),
        payments.map((payment) => ({
          entryId: payment.entryId,
          method: payment.method,
          amountCents: payment.amountCents,
          verified: payment.verifiedAt !== null,
          voided: payment.voidedAt !== null,
        }))
      ),
    }))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "OPEN" ? -1 : 1;
      const aDate = (a.drawingDate ?? a.createdAt).getTime();
      const bDate = (b.drawingDate ?? b.createdAt).getTime();
      return bDate - aDate;
    });
}

export type RaffleListItem = Awaited<ReturnType<typeof getRaffles>>[number];

/**
 * One raffle with everything its page shows: buyers (A–Z, each with their
 * boxes, balance and payments), every payment including voided ones, and the
 * totals. Null if the id matches nothing.
 */
export async function getRaffleDetail(raffleId: string) {
  const raffle = await prisma.raffle.findUnique({
    where: { id: raffleId },
    include: {
      entries: { include: { boxes: { select: { number: true }, orderBy: { number: "asc" } } } },
      payments: {
        include: { recordedByUser: { select: { username: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!raffle) return null;

  const { entries: rawEntries, payments: rawPayments, ...terms } = raffle;
  const entryNames = new Map(rawEntries.map((entry) => [entry.id, entry.name]));

  const payments = rawPayments.map(({ recordedByUser, ...payment }) => ({
    ...payment,
    entryName: payment.entryId ? (entryNames.get(payment.entryId) ?? null) : null,
    recordedByUsername: recordedByUser?.username ?? null,
  }));

  const summary: RaffleSummary = summarizeRaffle(
    terms,
    rawEntries.map((entry) => ({ id: entry.id, boxNumbers: entry.boxes.map((box) => box.number) })),
    payments.map((payment) => ({
      entryId: payment.entryId,
      method: payment.method,
      amountCents: payment.amountCents,
      verified: payment.verifiedAt !== null,
      voided: payment.voidedAt !== null,
    }))
  );

  const entries = rawEntries
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      notes: entry.notes,
      createdAt: entry.createdAt,
      boxNumbers: entry.boxes.map((box) => box.number),
      ...summary.balances.get(entry.id)!,
      payments: payments.filter((payment) => payment.entryId === entry.id),
    }))
    .sort(byName);

  return { ...terms, entries, payments, summary };
}

export type RaffleDetail = NonNullable<Awaited<ReturnType<typeof getRaffleDetail>>>;
export type RaffleEntryDetail = RaffleDetail["entries"][number];
export type RafflePaymentDetail = RaffleDetail["payments"][number];

/**
 * Names to offer while typing a buyer — everyone who has bought a box in any
 * raffle — and the names money has arrived under. Plain suggestions: a name
 * typed fresh works just as well, and nothing links one raffle's buyer to the
 * next beyond the spelling.
 */
export async function getRaffleNameSuggestions() {
  const [buyers, payers] = await Promise.all([
    prisma.raffleEntry.findMany({
      select: { name: true },
      distinct: ["name"],
      orderBy: { name: "asc" },
      take: NAME_SUGGESTION_LIMIT,
    }),
    prisma.rafflePayment.findMany({
      where: { payerName: { not: null } },
      select: { payerName: true },
      distinct: ["payerName"],
      orderBy: { payerName: "asc" },
      take: NAME_SUGGESTION_LIMIT,
    }),
  ]);
  return {
    buyerNames: buyers.map((buyer) => buyer.name),
    payerNames: payers.flatMap((payer) => (payer.payerName ? [payer.payerName] : [])),
  };
}

/**
 * Whose boxes a payer's money went toward last time, keyed by the payer's name
 * in lower case — so a Zelle that arrives under a business name or a spouse's
 * name can be shown as "last time this was for …" instead of being worked out
 * again from scratch.
 * Covers every raffle; the most recent match wins.
 */
export async function getPayerHistory(payerNames: string[]) {
  const wanted = [...new Set(payerNames.map((name) => name.trim().toLowerCase()).filter(Boolean))];
  const history = new Map<string, string>();
  if (wanted.length === 0) return history;

  // Compared in SQL rather than with Prisma's `mode: "insensitive"` equals,
  // which is an ILIKE: a payer name with "%" or "_" in it would match other
  // people's names.
  const matched = await prisma.$queryRaw<{ payerName: string; entryName: string }[]>`
    SELECT p."payerName", e."name" AS "entryName"
    FROM "RafflePayment" p
    JOIN "RaffleEntry" e ON e."id" = p."entryId"
    WHERE lower(btrim(p."payerName")) = ANY(${wanted}::text[])
      AND p."voidedAt" IS NULL
    ORDER BY p."createdAt" DESC, p."id" DESC`;
  for (const payment of matched) {
    const key = payment.payerName.trim().toLowerCase();
    if (key && !history.has(key)) history.set(key, payment.entryName);
  }
  return history;
}

/**
 * Every login that can hold the Raffle Helper permission, with whether it
 * does — for the Admin's picker on the raffles page. Sorted by name.
 */
export async function getRaffleHelperCandidates() {
  return prisma.user.findMany({
    where: { role: { in: RAFFLE_HELPER_ROLES } },
    select: { id: true, username: true, displayName: true, role: true, raffleHelper: true },
    orderBy: [{ displayName: "asc" }, { username: "asc" }],
  });
}
