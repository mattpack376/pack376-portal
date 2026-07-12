import Link from "next/link";
import { requireSession } from "@/lib/authorize";
import { prisma } from "@/lib/prisma";
import { RANK_ORDER, denDisplayName } from "@/lib/rankConfig";
import type { Rank } from "@/generated/prisma/enums";

export default async function RosterPage() {
  const session = await requireSession();
  const canSeeParentContacts = session.role === "ADMIN" || session.role === "JUNIOR_ADMIN" || session.role === "DEN";

  const dens = await prisma.den.findMany({
    include: {
      scouts: { orderBy: [{ lastName: "asc" }, { firstName: "asc" }] },
      denAssignments: { include: { user: { select: { displayName: true } } } },
    },
  });
  dens.sort((a, b) => {
    if (a.scoutingYear !== b.scoutingYear) return b.scoutingYear.localeCompare(a.scoutingYear);
    return RANK_ORDER.indexOf(a.rank as Rank) - RANK_ORDER.indexOf(b.rank as Rank);
  });

  const years = Array.from(new Set(dens.map((d) => d.scoutingYear)));

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Roster</div>
        <h2>Pack Roster</h2>
        <p>Every den, its leader(s), and its scouts — a clean master list, no advancement or attendance detail.</p>
        {canSeeParentContacts && (
          <p>
            <Link href="/portal/roster/parents" style={{ fontWeight: 700, color: "var(--carnival-red)" }}>
              → Cub&apos;s Parents&apos; Contact Information
            </Link>
          </p>
        )}
      </div>

      {dens.length === 0 && <div className="info-card">No dens yet.</div>}

      {years.map((year) => (
        <div key={year} style={{ marginBottom: 32 }}>
          <h3 style={{ fontSize: 17, marginBottom: 14 }}>{year}</h3>
          <div className="den-card-grid">
            {dens
              .filter((d) => d.scoutingYear === year)
              .map((den) => (
                <div className="info-card" key={den.id}>
                  <h3 style={{ marginTop: 0, fontSize: 16 }}>{denDisplayName(den.rank, den.scoutingYear, den.label)}</h3>
                  <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 12 }}>
                    Den Leader(s):{" "}
                    {den.denAssignments.length > 0 ? (
                      <strong>{den.denAssignments.map((a) => a.user.displayName).join(", ")}</strong>
                    ) : (
                      "No leader assigned yet"
                    )}
                  </p>
                  {den.scouts.length === 0 ? (
                    <p style={{ marginBottom: 0, fontSize: 14 }}>No scouts yet.</p>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {den.scouts.map((scout) => (
                        <li key={scout.id} style={{ fontSize: 14, marginBottom: 4 }}>
                          {scout.firstName} {scout.lastName}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
          </div>
        </div>
      ))}
    </>
  );
}
