import { RANK_INFO } from "@/lib/rankConfig";
import { paymentStatusLabel } from "@/lib/paymentStatus";
import type { Rank } from "@/generated/prisma/enums";

/*
 * What the dues exports (CSV and PDF) carry, built from getDuesOverview — the
 * same data, den order, scout order and totals as the Dues Tracking page — so
 * the two files can't disagree with each other or with the page. No I/O here:
 * duesExport.ts loads and authorizes, this shapes, the builders draw.
 */

export type DuesOverviewInput = {
  scoutingYear: string;
  amountCents: number | null;
  dens: {
    rank: Rank;
    label: string | null;
    scouts: {
      firstName: string;
      lastName: string;
      active: boolean;
      dueCents: number | null;
      isOverridden: boolean;
      paidCents: number;
      remainingCents: number | null;
      payments: { paidOn: Date; amountCents: number; note: string | null }[];
    }[];
  }[];
};

export type DuesExportScout = {
  firstName: string;
  lastName: string;
  active: boolean;
  dueCents: number | null;
  isOverridden: boolean;
  paidCents: number;
  remainingCents: number | null;
  status: string;
  paymentCount: number;
  lastPaidOn: Date | null;
};

export type DuesExportPayment = {
  denName: string;
  firstName: string;
  lastName: string;
  paidOn: Date;
  amountCents: number;
  note: string;
};

export type DuesExportDen = {
  name: string;
  scouts: DuesExportScout[];
  /** Null when the season fee isn't set, like the page's "—". */
  dueCents: number | null;
  paidCents: number;
  remainingCents: number | null;
};

export type DuesExport = {
  scoutingYear: string;
  /** The standard season fee, null when it isn't set yet. */
  amountCents: number | null;
  scoutCount: number;
  /** The page's three cards: Total Dues to be Collected, Collected So Far, and remaining (never below zero). */
  totalDueCents: number | null;
  collectedCents: number;
  remainingCents: number | null;
  dens: DuesExportDen[];
  /** Every payment for the year, den by den in page order, oldest first within a scout. */
  payments: DuesExportPayment[];
};

export function duesDenName(rank: Rank, label: string | null) {
  return `${RANK_INFO[rank].label}${label ? ` ${label}` : ""}`;
}

function sum(values: number[]) {
  return values.reduce((total, n) => total + n, 0);
}

export function buildDuesExportModel(overview: DuesOverviewInput): DuesExport {
  const { amountCents } = overview;
  const payments: DuesExportPayment[] = [];

  const dens = overview.dens.map((den): DuesExportDen => {
    const name = duesDenName(den.rank, den.label);
    const scouts = den.scouts.map((s): DuesExportScout => {
      const ordered = [...s.payments].sort((a, b) => a.paidOn.getTime() - b.paidOn.getTime());
      for (const p of ordered) {
        payments.push({
          denName: name,
          firstName: s.firstName,
          lastName: s.lastName,
          paidOn: p.paidOn,
          amountCents: p.amountCents,
          note: p.note ?? "",
        });
      }
      return {
        firstName: s.firstName,
        lastName: s.lastName,
        active: s.active,
        dueCents: s.dueCents,
        isOverridden: s.isOverridden,
        paidCents: s.paidCents,
        remainingCents: s.remainingCents,
        status: paymentStatusLabel(s.remainingCents, s.paidCents),
        paymentCount: ordered.length,
        lastPaidOn: ordered.length ? ordered[ordered.length - 1].paidOn : null,
      };
    });
    // Same rule as the page's total: with no season fee nothing is "due" yet.
    const dueCents = amountCents === null ? null : sum(den.scouts.map((s) => s.dueCents ?? amountCents));
    const paidCents = sum(scouts.map((s) => s.paidCents));
    return {
      name,
      scouts,
      dueCents,
      paidCents,
      remainingCents: dueCents === null ? null : dueCents - paidCents,
    };
  });

  const totalDueCents = amountCents === null ? null : sum(dens.map((d) => d.dueCents ?? 0));
  const collectedCents = sum(dens.map((d) => d.paidCents));

  return {
    scoutingYear: overview.scoutingYear,
    amountCents,
    scoutCount: sum(dens.map((d) => d.scouts.length)),
    totalDueCents,
    collectedCents,
    remainingCents: totalDueCents === null ? null : Math.max(totalDueCents - collectedCents, 0),
    dens,
    payments,
  };
}

/** Download name for one of the exports, e.g. pack376-dues-2026-2027.pdf. */
export function duesExportFilename(scoutingYear: string, kind: "balances" | "payments", ext: "csv" | "pdf") {
  return `pack376-dues-${scoutingYear}${kind === "payments" ? "-payments" : ""}.${ext}`;
}
