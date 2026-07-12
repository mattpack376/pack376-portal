import { requireMasterAdminSession } from "@/lib/authorize";
import { prisma } from "@/lib/prisma";
import ResetPackDataForm from "@/components/ResetPackDataForm";

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

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Danger Zone</div>
        <h2>Start a Fresh Year</h2>
        <p>
          Permanently deletes every scout on every den&apos;s roster for one scouting year — along
          with their advancement checkmarks, attendance history, and dues payments. Dens, the
          meeting calendar (including cancelled dates), the adventure list, dues settings, and every
          login stay exactly as they are — and other scouting years aren&apos;t touched.
        </p>
      </div>

      <div className="info-card" style={{ maxWidth: 480, borderTop: "6px solid var(--carnival-red)" }}>
        {scoutingYears.length > 0 && (
          <ul style={{ marginTop: 0 }}>
            {scoutingYears.map((year) => (
              <li key={year}>
                <strong>{year}</strong>: {countsByYear.get(year)} scout{countsByYear.get(year) === 1 ? "" : "s"}
              </li>
            ))}
          </ul>
        )}
        <ResetPackDataForm scoutingYears={scoutingYears} />
      </div>
    </>
  );
}
