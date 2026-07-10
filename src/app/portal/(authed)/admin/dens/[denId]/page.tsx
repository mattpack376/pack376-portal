import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getDenChecklist } from "@/lib/denData";
import { denDisplayName, nextRank } from "@/lib/rankConfig";
import { addScoutAction, removeScoutAction } from "@/lib/actions/dens";
import ScoutChecklist from "@/components/ScoutChecklist";

export default async function AdminDenDetailPage({
  params,
}: {
  params: Promise<{ denId: string }>;
}) {
  const { denId } = await params;
  const data = await getDenChecklist(denId);
  if (!data) notFound();

  const session = await getSession();
  const isFullAdmin = session?.role === "ADMIN";

  const { den, scouts } = data;
  const users = await prisma.user.findMany({ where: { denId }, select: { username: true } });
  const canPromote = isFullAdmin && nextRank(den.rank) !== null;

  return (
    <>
      <div className="section-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div className="eyebrow">
            <Link href="/portal/admin">← All Dens</Link>
          </div>
          <h2>{denDisplayName(den.rank, den.scoutingYear, den.label)}</h2>
          <p>
            {users.length > 0
              ? `Login${users.length > 1 ? "s" : ""}: ${users.map((u) => u.username).join(", ")}`
              : "No login created for this den yet."}
          </p>
        </div>
        {canPromote && (
          <Link className="btn btn-red" href={`/portal/admin/dens/${den.id}/promote`}>
            Promote to Next Rank →
          </Link>
        )}
      </div>

      <div className="info-card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Roster</h3>
        {scouts.length === 0 && <p>No scouts yet.</p>}
        {scouts.length > 0 && (
          <table className="data-table" style={{ marginBottom: 20 }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Progress</th>
                {isFullAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {scouts.map((scout) => (
                <tr key={scout.id}>
                  <td>{scout.firstName} {scout.lastName}</td>
                  <td>
                    {scout.requiredDone}/{scout.requiredTotal} required · {scout.electivesDone}/
                    {scout.electivesRequired}+ electives
                  </td>
                  {isFullAdmin && (
                    <td className="actions">
                      <form action={removeScoutAction}>
                        <input type="hidden" name="scoutId" value={scout.id} />
                        <input type="hidden" name="denId" value={den.id} />
                        <button type="submit" className="btn btn-outline btn-small" style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}>
                          Remove
                        </button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {isFullAdmin && (
          <form action={addScoutAction} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <input type="hidden" name="denId" value={den.id} />
            <div className="form-field" style={{ marginBottom: 0, flex: "1 1 160px" }}>
              <label htmlFor="firstName">First Name</label>
              <input id="firstName" name="firstName" type="text" required />
            </div>
            <div className="form-field" style={{ marginBottom: 0, flex: "1 1 160px" }}>
              <label htmlFor="lastName">Last Name</label>
              <input id="lastName" name="lastName" type="text" required />
            </div>
            <button type="submit" className="btn btn-primary">Add Scout</button>
          </form>
        )}
      </div>

      <ScoutChecklist scouts={scouts} editable />
    </>
  );
}
