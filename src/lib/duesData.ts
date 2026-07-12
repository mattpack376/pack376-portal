import "server-only";
import { prisma } from "@/lib/prisma";
import { RANK_ORDER } from "@/lib/rankConfig";
import type { Rank } from "@/generated/prisma/enums";

export function formatCents(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export async function getDuesScoutingYears() {
  const dens = await prisma.den.findMany({ select: { scoutingYear: true }, distinct: ["scoutingYear"] });
  return dens.map((d) => d.scoutingYear).sort().reverse();
}

export async function getDuesOverview(scoutingYear: string) {
  const [settings, dens] = await Promise.all([
    prisma.duesSettings.findUnique({ where: { scoutingYear } }),
    prisma.den.findMany({
      where: { scoutingYear },
      include: {
        scouts: {
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          include: { duesPayments: true },
        },
      },
    }),
  ]);
  dens.sort((a, b) => RANK_ORDER.indexOf(a.rank as Rank) - RANK_ORDER.indexOf(b.rank as Rank));

  const amountCents = settings?.amountCents ?? null;

  return {
    scoutingYear,
    amountCents,
    dens: dens.map((den) => ({
      id: den.id,
      rank: den.rank,
      label: den.label,
      scouts: den.scouts.map((s) => {
        const paidCents = s.duesPayments.reduce((sum, p) => sum + p.amountCents, 0);
        return {
          id: s.id,
          firstName: s.firstName,
          lastName: s.lastName,
          paidCents,
          remainingCents: amountCents === null ? null : amountCents - paidCents,
        };
      }),
    })),
  };
}

export async function getScoutDuesDetail(scoutId: string) {
  const scout = await prisma.scout.findUnique({
    where: { id: scoutId },
    include: {
      den: true,
      duesPayments: {
        orderBy: { paidOn: "desc" },
        include: { recordedByUser: { select: { username: true } } },
      },
    },
  });
  if (!scout) return null;

  const settings = await prisma.duesSettings.findUnique({ where: { scoutingYear: scout.den.scoutingYear } });
  const amountCents = settings?.amountCents ?? null;
  const paidCents = scout.duesPayments.reduce((sum, p) => sum + p.amountCents, 0);

  return {
    scout: { id: scout.id, firstName: scout.firstName, lastName: scout.lastName },
    den: scout.den,
    amountCents,
    paidCents,
    remainingCents: amountCents === null ? null : amountCents - paidCents,
    payments: scout.duesPayments.map((p) => ({
      id: p.id,
      amountCents: p.amountCents,
      paidOn: p.paidOn,
      note: p.note,
      createdAt: p.createdAt,
      recordedByUsername: p.recordedByUser?.username ?? null,
    })),
  };
}
