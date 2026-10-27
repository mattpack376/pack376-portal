import "server-only";
import { prisma } from "@/lib/prisma";
import { buyerNameKey, summarizeRaffle, type RaffleSummary } from "@/lib/raffleMath";
import { RAFFLE_HELPER_ROLES } from "@/lib/authorize";

const NAME_SUGGESTION_LIMIT = 500;
/** Decades of this pack's raffles; the newest payments are the ones that matter. */
const PAYER_HISTORY_LIMIT = 5_000;

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
 * Whose boxes a payer's money went toward last time, keyed by buyerNameKey of
 * the payer's name — so a Zelle that arrives under a business name or a
 * spouse's name can be shown as "last time this was for …" instead of being
 * worked out again from scratch.
 * Covers every raffle; the most recent match wins.
 *
 * Names are compared in JavaScript with buyerNameKey, exactly, the way the
 * raffle pages compare buyer names: not with Prisma's `mode: "insensitive"`
 * equals, which is an ILIKE ("%" or "_" in a payer name matched other
 * people's), and not with Postgres's lower(), which on a "C"-locale database
 * leaves "JOSÉ" unmatched with "José".
 */
export async function getPayerHistory(payerNames: string[]) {
  const wanted = new Set(payerNames.map(buyerNameKey).filter(Boolean));
  const history = new Map<string, string>();
  if (wanted.size === 0) return history;

  const payments = await prisma.rafflePayment.findMany({
    where: { voidedAt: null, payerName: { not: null }, entryId: { not: null } },
    select: { payerName: true, entry: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAYER_HISTORY_LIMIT,
  });
  for (const payment of payments) {
    const key = buyerNameKey(payment.payerName ?? "");
    if (payment.entry && wanted.has(key) && !history.has(key)) history.set(key, payment.entry.name);
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
