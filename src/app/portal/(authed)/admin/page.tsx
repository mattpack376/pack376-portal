import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { RANK_ORDER, RANK_INFO, denDisplayName } from "@/lib/rankConfig";
import { requireAdvancementSession } from "@/lib/authorize";
import { isMasterAdminUsername } from "@/lib/masterAdmins";
import EmailAllButton from "@/components/EmailAllButton";

export default async function AdminDashboardPage() {
  const session = await requireAdvancementSession();
  const sessionUser =
    session.role === "ADMIN" ? await prisma.user.findUnique({ where: { id: session.userId }, select: { username: true } }) : null;
  const isMasterAdmin = !!sessionUser && isMasterAdminUsername(sessionUser.username);

  const dens = await prisma.den.findMany({
    include: {
      _count: { select: { scouts: true } },
      denAssignments: { include: { user: { select: { displayName: true } } } },
    },
  });

  const [parentEmails, userEmails] = session.role === "ADMIN"
    ? await Promise.all([
        prisma.parent.findMany({ where: { email: { not: null } }, select: { email: true } }),
        prisma.user.findMany({ where: { email: { not: null } }, select: { email: true } }),
      ])
    : [[], []];
  const everyoneEmails = [...parentEmails, ...userEmails].map((r) => r.email);

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

      {session.role === "ADMIN" && (
        <div className="info-card" style={{ marginBottom: 24 }}>
          <h3 style={{ marginTop: 0 }}>Email Everyone</h3>
          <p style={{ marginBottom: 12 }}>
            Every scout&apos;s parent/guardian and every user account (den leaders, admins, etc.) that has an
            email address on file. Opens your own email app with everyone bcc&apos;d — nothing is sent from here.
          </p>
          <EmailAllButton label="Email All Parents & Leaders" emails={everyoneEmails} />
        </div>
      )}

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
                    {den.denAssignments.length > 0
                      ? ` · ${den.denAssignments.map((a) => a.user.displayName).join(", ")}`
                      : " · no leader assigned yet"}
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

      {isMasterAdmin && (
        <p style={{ marginTop: 16 }}>
          <Link href="/portal/admin/reset" style={{ color: "var(--carnival-red)", fontWeight: 700, fontSize: 13 }}>
            Danger Zone: Start a Fresh Year →
          </Link>
        </p>
      )}
    </>
  );
}
