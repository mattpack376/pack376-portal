import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { RANK_ORDER, RANK_INFO, denDisplayName } from "@/lib/rankConfig";
import { requireAdvancementSession } from "@/lib/authorize";

export default async function AdminDashboardPage() {
  const session = await requireAdvancementSession();

  const dens = await prisma.den.findMany({
    include: { _count: { select: { scouts: true } }, users: { select: { username: true } } },
  });

  dens.sort((a, b) => {
    if (a.scoutingYear !== b.scoutingYear) return b.scoutingYear.localeCompare(a.scoutingYear);
    return RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank);
  });

  const years = Array.from(new Set(dens.map((d) => d.scoutingYear)));

  return (
    <>
      <div className="section-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div className="eyebrow">All Dens</div>
          <h2>Admin Dashboard</h2>
        </div>
        {session.role === "ADMIN" && (
          <Link className="btn btn-primary" href="/portal/admin/dens/new">+ New Den</Link>
        )}
      </div>

      {dens.length === 0 && <div className="info-card">No dens yet — create the first one to get started.</div>}

      {years.map((year) => (
        <div key={year} style={{ marginBottom: 32 }}>
          <h3 style={{ fontSize: 17, marginBottom: 14 }}>{year}</h3>
          <div className="den-card-grid">
            {dens
              .filter((d) => d.scoutingYear === year)
              .map((den) => (
                <Link className="den-tile" key={den.id} href={`/portal/admin/dens/${den.id}`}>
                  <h3>{denDisplayName(den.rank, den.scoutingYear, den.label)}</h3>
                  <p>
                    {den._count.scouts} scout{den._count.scouts === 1 ? "" : "s"}
                    {den.users.length > 0 ? ` · ${den.users.map((u) => u.username).join(", ")}` : " · no login yet"}
                  </p>
                </Link>
              ))}
          </div>
        </div>
      ))}

      <div className="info-card" style={{ marginTop: 8 }}>
        <h3 style={{ marginTop: 0 }}>Ranks</h3>
        <p style={{ marginBottom: 0 }}>
          {RANK_ORDER.map((r) => RANK_INFO[r].label).join(" → ")} — a den&apos;s scouts move up one rank each
          scouting year. Use &quot;Promote Den&quot; on a den&apos;s page each fall to carry the roster forward.
        </p>
      </div>
    </>
  );
}
