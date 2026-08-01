import Link from "next/link";
import { requireRosterSession } from "@/lib/authorize";
import { prisma } from "@/lib/prisma";
import { RANK_ORDER, denDisplayName } from "@/lib/rankConfig";
import type { Rank } from "@/generated/prisma/enums";

export default async function RosterPage() {
  const session = await requireRosterSession();
  const canSeeParentContacts = session.role === "ADMIN" || session.role === "JUNIOR_ADMIN" || session.role === "DEN";
  const canSeePhotoConsent = canSeeParentContacts || session.role === "PHOTOGRAPHER";

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
        <p style={{ fontSize: 17 }}>
          Every den, its leader(s), and its scouts — a clean master list, no advancement or attendance detail.
        </p>
        {canSeeParentContacts && (
          <p style={{ fontSize: 17 }}>
            <Link href="/portal/roster/parents" style={{ fontWeight: 700, color: "var(--carnival-red)" }}>
              → Cub&apos;s Parents&apos; Contact Information
            </Link>
          </p>
        )}
        {canSeePhotoConsent && (
          <p style={{ fontSize: 17 }}>
            <Link href="/portal/roster/photo-consent" style={{ fontWeight: 700, color: "var(--carnival-red)" }}>
              → Photo Consent
            </Link>
          </p>
        )}
        {session.role === "ADMIN" && (
          <p style={{ fontSize: 17 }}>
            <Link href="/portal/roster/family-view" style={{ fontWeight: 700, color: "var(--carnival-red)" }}>
              → Family View (What Parents See)
            </Link>
          </p>
        )}
      </div>

      {dens.length === 0 && <div className="info-card" style={{ fontSize: 16 }}>No dens yet.</div>}

      {years.map((year) => {
        const yearDens = dens.filter((d) => d.scoutingYear === year);
        const yearScoutCount = yearDens.reduce((sum, d) => sum + d.scouts.length, 0);
        return (
        <div key={year} style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
            <h3 style={{ fontSize: 19, margin: 0 }}>{year}</h3>
            <span className="badge-pill badge-den badge-count" style={{ whiteSpace: "nowrap" }}>
              {yearScoutCount} scout{yearScoutCount === 1 ? "" : "s"} total
            </span>
          </div>
          <div className="den-card-grid">
            {yearDens
              .map((den) => (
                <div className="info-card" key={den.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <h3 style={{ marginTop: 0, fontSize: 18 }}>{denDisplayName(den.rank, den.scoutingYear, den.label)}</h3>
                    <span className="badge-pill badge-den badge-count" style={{ whiteSpace: "nowrap" }}>
                      {den.scouts.length} scout{den.scouts.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p style={{ fontSize: 15, color: "var(--ink-soft)", marginBottom: 12 }}>
                    Den Leader(s):{" "}
                    {den.denAssignments.length > 0 ? (
                      <strong>{den.denAssignments.map((a) => a.user.displayName).join(", ")}</strong>
                    ) : (
                      "No leader assigned yet"
                    )}
                  </p>
                  {den.scouts.length === 0 ? (
                    <p style={{ marginBottom: 0, fontSize: 16 }}>No scouts yet.</p>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {den.scouts.map((scout) => (
                        <li key={scout.id} style={{ fontSize: 16, marginBottom: 4 }}>
                          {scout.firstName} {scout.lastName}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
          </div>
        </div>
        );
      })}
    </>
  );
}
