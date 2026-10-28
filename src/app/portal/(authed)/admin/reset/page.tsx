import { requireMasterAdminSession } from "@/lib/authorize";
import { prisma } from "@/lib/prisma";
import ResetPackDataForm from "@/components/ResetPackDataForm";
import { paymentSummariesByScout } from "@/lib/scoutDeletion";
import { paymentDeletionWarning } from "@/lib/paymentRecords";
import { formatCents } from "@/lib/duesData";

export default async function AdminResetPage() {
  await requireMasterAdminSession();

  const dens = await prisma.den.findMany({
    select: { scoutingYear: true, _count: { select: { scouts: true } } },
  });
  const countsByYear = new Map<string, number>();
  for (const den of dens) {
    countsByYear.set(den.scoutingYear, (countsByYear.get(den.scoutingYear) ?? 0) + den._count.scouts);
  }
  const scoutingYears = Array.from(countsByYear.keys()).sort().reverse();

  // Each season's dues and event payments, for the warning above the
  // confirmation box: the reset keeps them in Payment Records, but the admin
  // should see how much money is attached before typing the phrase.
  const scouts = await prisma.scout.findMany({ select: { id: true, den: { select: { scoutingYear: true } } } });
  const byScout = await paymentSummariesByScout(scouts.map((s) => s.id));
  const paymentsByYear: Record<string, { count: number; totalCents: number; total: string; warning: string }> = {};
  for (const year of scoutingYears) {
    let count = 0;
    let totalCents = 0;
    for (const s of scouts) {
      if (s.den.scoutingYear !== year) continue;
      const summary = byScout.get(s.id);
      count += summary?.count ?? 0;
      totalCents += summary?.totalCents ?? 0;
    }
    paymentsByYear[year] = {
      count,
      totalCents,
      total: formatCents(totalCents),
      warning: paymentDeletionWarning({ count, totalCents }).trim(),
    };
  }

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Danger Zone</div>
        <h2>Start a Fresh Year</h2>
        <p>
          Permanently deletes every scout on every den&apos;s roster for one scouting year — along
          with their advancement checkmarks, attendance history, and dues payments. Dens, the
          meeting calendar (including cancelled dates), the leader &amp; committee list and its
          attendance, the adventure list, dues settings, and every login stay exactly as they are — and
          other scouting years aren&apos;t touched. Any payments those scouts had are kept under
          Admin → Payment Records, where you can mark each one refunded or kept by the pack.
        </p>
      </div>

      <div className="info-card" style={{ maxWidth: 480, borderTop: "6px solid var(--carnival-red)" }}>
        {scoutingYears.length > 0 && (
          <ul style={{ margin: "0 0 16px", paddingLeft: 20 }}>
            {scoutingYears.map((year) => (
              <li key={year}>
                <strong>{year}</strong>: {countsByYear.get(year)} scout{countsByYear.get(year) === 1 ? "" : "s"}
                {paymentsByYear[year].count > 0 &&
                  `, ${paymentsByYear[year].count} payment${paymentsByYear[year].count === 1 ? "" : "s"} (${paymentsByYear[year].total})`}
              </li>
            ))}
          </ul>
        )}
        <ResetPackDataForm scoutingYears={scoutingYears} paymentsByYear={paymentsByYear} />
      </div>
    </>
  );
}
