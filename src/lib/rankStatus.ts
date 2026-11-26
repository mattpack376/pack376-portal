import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { AdventureType, Rank } from "@/generated/prisma/enums";
import { toDateOnlyString } from "@/lib/dateOnly";
import { RANK_INFO } from "@/lib/rankConfig";
import { rankProgress, type RankProgress } from "@/lib/advancementAuditRules";

/*
 * Where each scout stands on their den's rank badge: earned or not (from
 * their adventure records, rankProgress), the stored award if the badge has
 * been handed out (ScoutRankAward), and the ranks awarded in earlier seasons
 * (followed back through Scout.previousScoutId, which Promote Den sets).
 * Every page that shows a rank's status reads it from here — the den page's
 * cards and summary, the Parent Dashboard, the roster — and the award actions
 * use rankProgressFor inside their transactions.
 */

type Db = typeof prisma | Prisma.TransactionClient;

/** Each scout's progress on their own den's rank, read inside `db` (a transaction, or the client). */
export async function rankProgressFor(
  db: Db,
  scouts: readonly { id: string; rank: Rank }[],
): Promise<Map<string, RankProgress>> {
  const result = new Map<string, RankProgress>();
  if (scouts.length === 0) return result;
  const ranks = [...new Set(scouts.map((s) => s.rank))];
  const [adventures, records] = await Promise.all([
    db.adventure.findMany({ where: { rank: { in: ranks } }, select: { id: true, rank: true, type: true } }),
    db.advancementRecord.findMany({
      where: { scoutId: { in: [...new Set(scouts.map((s) => s.id))] }, adventure: { rank: { in: ranks } } },
      select: { scoutId: true, adventureId: true, completed: true, completedDate: true },
    }),
  ]);
  const byRank = new Map<Rank, { id: string; type: AdventureType }[]>();
  for (const a of adventures) byRank.set(a.rank, [...(byRank.get(a.rank) ?? []), a]);
  const recordsByScout = new Map<string, typeof records>();
  for (const r of records) recordsByScout.set(r.scoutId, [...(recordsByScout.get(r.scoutId) ?? []), r]);
  for (const scout of scouts) {
    const list = byRank.get(scout.rank) ?? [];
    const ids = new Set(list.map((a) => a.id));
    result.set(
      scout.id,
      rankProgress(
        list,
        (recordsByScout.get(scout.id) ?? [])
          .filter((r) => ids.has(r.adventureId))
          .map((r) => ({ adventureId: r.adventureId, completed: r.completed, completedDate: toDateOnlyString(r.completedDate) })),
      ),
    );
  }
  return result;
}

export type RankAwardInfo = {
  /** YYYY-MM-DD. */
  awardedDate: string;
  /** ISO — the card sends it back so Undo can tell the award hasn't changed since. */
  updatedAt: string;
  enteredBy: string | null;
};

export type ScoutRankStatus = {
  rank: Rank;
  /** "Wolf". */
  rankLabel: string;
  progress: RankProgress;
  award: RankAwardInfo | null;
  /** Ranks awarded in earlier seasons, oldest first. Only seasons linked by Promote Den. */
  previous: { rank: Rank; rankLabel: string; awardedDate: string; scoutingYear: string }[];
};

/** How far back "Previous ranks" looks: Lion through Webelos is five seasons before Arrow of Light. */
const MAX_PREVIOUS = 6;

/**
 * Rank status for every scout named, keyed by scout id. Ids are deduped before
 * any `in:` list (a repeated id breaks included relations on adapter-pg).
 * Callers decide who may see which scouts — this reads whatever it's given.
 */
export async function loadRankStatuses(scoutIds: readonly string[]): Promise<Map<string, ScoutRankStatus>> {
  const ids = [...new Set(scoutIds)];
  const result = new Map<string, ScoutRankStatus>();
  if (ids.length === 0) return result;

  const scouts = await prisma.scout.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      previousScoutId: true,
      den: { select: { rank: true } },
      rankAwards: { include: { updatedByUser: { select: { displayName: true } } } },
    },
  });
  const progress = await rankProgressFor(
    prisma,
    scouts.map((s) => ({ id: s.id, rank: s.den.rank })),
  );

  // Walk back through earlier seasons a level at a time.
  const previousOf = new Map<string, string>(); // a scout row -> the row before it
  let frontier = scouts.flatMap((s) => (s.previousScoutId ? [s.previousScoutId] : []));
  for (const s of scouts) if (s.previousScoutId) previousOf.set(s.id, s.previousScoutId);
  const earlier = new Map<
    string,
    { previousScoutId: string | null; scoutingYear: string; awards: { rank: Rank; awardedDate: Date }[] }
  >();
  for (let depth = 0; depth < MAX_PREVIOUS && frontier.length > 0; depth++) {
    const rows = await prisma.scout.findMany({
      where: { id: { in: [...new Set(frontier)].filter((id) => !earlier.has(id)) } },
      select: {
        id: true,
        previousScoutId: true,
        den: { select: { scoutingYear: true } },
        rankAwards: { select: { rank: true, awardedDate: true } },
      },
    });
    for (const row of rows) {
      earlier.set(row.id, { previousScoutId: row.previousScoutId, scoutingYear: row.den.scoutingYear, awards: row.rankAwards });
    }
    frontier = rows.flatMap((r) => (r.previousScoutId && !earlier.has(r.previousScoutId) ? [r.previousScoutId] : []));
  }

  for (const scout of scouts) {
    const rank = scout.den.rank;
    const award = scout.rankAwards.find((a) => a.rank === rank) ?? null;
    const previous: ScoutRankStatus["previous"] = [];
    const seen = new Set<string>([scout.id]);
    let cursor = previousOf.get(scout.id) ?? null;
    while (cursor && !seen.has(cursor) && earlier.has(cursor)) {
      seen.add(cursor);
      const row = earlier.get(cursor)!;
      for (const a of row.awards) {
        previous.push({
          rank: a.rank,
          rankLabel: RANK_INFO[a.rank].label,
          awardedDate: toDateOnlyString(a.awardedDate),
          scoutingYear: row.scoutingYear,
        });
      }
      cursor = row.previousScoutId;
    }
    previous.sort((a, b) => a.awardedDate.localeCompare(b.awardedDate));
    result.set(scout.id, {
      rank,
      rankLabel: RANK_INFO[rank].label,
      progress: progress.get(scout.id)!,
      award: award
        ? {
            awardedDate: toDateOnlyString(award.awardedDate),
            updatedAt: award.updatedAt.toISOString(),
            enteredBy: award.updatedByUser?.displayName ?? null,
          }
        : null,
      previous,
    });
  }
  return result;
}
