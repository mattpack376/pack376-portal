import "server-only";
import { getSession } from "@/lib/auth";
import { canViewPendingAwards, pendingAwardsDenIds } from "@/lib/authorize";
import { prisma } from "@/lib/prisma";
import { scoutingYearForDate } from "@/lib/attendanceSchedule";
import { todayDateOnly, toDateOnlyString } from "@/lib/dateOnly";
import { toCsv } from "@/lib/csv";
import { formatDateOnly } from "@/lib/dateOnly";
import { RANK_INFO } from "@/lib/rankConfig";
import { loadPendingAwards } from "@/lib/pendingAwardsData";
import { parsePendingAwardFilters } from "@/lib/pendingAwardsRules";

/*
 * The data behind Pending Awards' "Shopping list CSV/PDF" (built in
 * shoppingList.ts / shoppingListPdf.ts): the items the page's filters match, in
 * the dens the viewer may see, exactly as the page loads them
 * (loadPendingAwards). Held-back (flagged) items aren't counted, only noted.
 */

export async function loadPendingAwardsExport(searchParams: URLSearchParams) {
  const session = await getSession();
  if (!session) return { status: 401 as const };
  if (!canViewPendingAwards(session)) return { status: 403 as const };
  const filters = parsePendingAwardFilters(Object.fromEntries(searchParams.entries()));
  const data = await loadPendingAwards(session, filters);
  // A den outside the viewer's own (an old link, an edited URL) matches nothing; say so rather than "Every den".
  const denName = filters.denId ? data.dens.find((d) => d.id === filters.denId)?.name ?? "Den not available" : null;
  return { filters, year: data.year, denName, items: data.items, heldBack: data.heldBack.length };
}

/**
 * "Ranks awarded": every rank badge handed out this season in the dens the
 * viewer may see (the same dens as Pending Awards) — scout, den, rank, award
 * date and who entered it. Active scouts only, like the page.
 */
export async function loadRankAwardsExport(searchParams: URLSearchParams) {
  const session = await getSession();
  if (!session) return { status: 401 as const };
  if (!canViewPendingAwards(session)) return { status: 403 as const };
  const denIds = pendingAwardsDenIds(session);
  const year = scoutingYearForDate(todayDateOnly());
  const denId = searchParams.get("denId");
  const dens = await prisma.den.findMany({
    where: {
      scoutingYear: year,
      ...(denIds === "all" ? {} : { id: { in: denIds } }),
      ...(denId && denId.length <= 64 ? { id: denIds === "all" || denIds.includes(denId) ? denId : "" } : {}),
    },
    orderBy: [{ rank: "asc" }, { label: "asc" }],
    select: {
      rank: true,
      label: true,
      scouts: {
        where: { active: true },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        select: {
          firstName: true,
          lastName: true,
          rankAwards: { select: { rank: true, awardedDate: true, updatedByUser: { select: { displayName: true } } } },
        },
      },
    },
  });
  const rows = dens.flatMap((den) =>
    den.scouts.flatMap((scout) =>
      scout.rankAwards
        .filter((a) => a.rank === den.rank)
        .map((a) => ({
          scoutName: `${scout.firstName} ${scout.lastName}`.trim(),
          denName: `${RANK_INFO[den.rank].label}${den.label ? ` ${den.label}` : ""} Den`,
          rank: RANK_INFO[a.rank].label,
          awardedDate: toDateOnlyString(a.awardedDate),
          enteredBy: a.updatedByUser?.displayName ?? "",
        })),
    ),
  );
  return { year, rows };
}

export function buildRankAwardsCsv(rows: { scoutName: string; denName: string; rank: string; awardedDate: string; enteredBy: string }[]) {
  return toCsv([
    ["Scout", "Den", "Rank", "Awarded", "Entered by"],
    ...rows.map((r) => [r.scoutName, r.denName, r.rank, formatDateOnly(r.awardedDate), r.enteredBy]),
  ]);
}
