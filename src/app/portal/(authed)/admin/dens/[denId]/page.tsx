import Link from "next/link";
import SaveButton from "@/components/SaveButton";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canAddScoutsToDens, requireAdvancementSession } from "@/lib/authorize";
import { getDenChecklist } from "@/lib/denData";
import { denDisplayName, nextRank } from "@/lib/rankConfig";
import { addScoutAction, removeScoutAction, updateScoutNameAction } from "@/lib/actions/dens";
import { setScoutActiveAction } from "@/lib/actions/scouts";
import ScoutChecklist from "@/components/ScoutChecklist";

export default async function AdminDenDetailPage({
  params,
}: {
  params: Promise<{ denId: string }>;
}) {
  // Checked here as well as in the layout: a layout isn't re-run on every
  // navigation and doesn't stop this page rendering, so the page guards its own data.
  const session = await requireAdvancementSession();
  const { denId } = await params;
  const data = await getDenChecklist(denId);
  if (!data) notFound();

  const isFullAdmin = session.role === "ADMIN";
  // Junior Admin can add a scout; renaming and removing stay Admin-only.
  const canAddScouts = canAddScoutsToDens(session);

  const { den, scouts, inactiveScouts } = data;
  const assignments = await prisma.denAssignment.findMany({
    where: { denId, user: { active: true } },
    include: { user: { select: { id: true, username: true, displayName: true } } },
  });
  const canPromote = isFullAdmin && nextRank(den.rank) !== null;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link href="/portal/admin">← All Dens</Link>
          </div>
          <h2>{denDisplayName(den.rank, den.scoutingYear, den.label)}</h2>
          <p>
            {assignments.length > 0 ? (
              <>
                Leader{assignments.length > 1 ? "s" : ""}:{" "}
                {assignments.map((a, i) => (
                  <span key={a.user.id}>
                    {i > 0 && ", "}
                    {isFullAdmin ? (
                      <Link href={`/portal/admin/users/${a.user.id}`}>
                        {a.user.displayName} ({a.user.username})
                      </Link>
                    ) : (
                      a.user.displayName
                    )}
                  </span>
                ))}
              </>
            ) : (
              "No leader assigned to this den yet."
            )}
          </p>
        </div>
        {canPromote && (
          <Link className="btn btn-red" href={`/portal/admin/dens/${den.id}/promote`}>
            Promote to Next Rank →
          </Link>
        )}
      </div>

      <div className="info-card" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <h3>Roster</h3>
          <span className="badge-pill badge-den badge-count" style={{ whiteSpace: "nowrap" }}>
            {scouts.length} scout{scouts.length === 1 ? "" : "s"}
          </span>
        </div>
        {scouts.length === 0 && <p>No scouts yet.</p>}
        {scouts.length > 0 && (
          <div className="table-scroll" style={{ marginBottom: 20 }}>
          <table className="data-table">
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
                  <td>
                    {isFullAdmin ? (
                      <form
                        action={updateScoutNameAction}
                        style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}
                      >
                        <input type="hidden" name="scoutId" value={scout.id} />
                        <input type="hidden" name="denId" value={den.id} />
                        <input
                          name="firstName"
                          defaultValue={scout.firstName}
                          required
                          aria-label="First name"
                          style={{
                            width: 100,
                            padding: "7px 10px",
                            borderRadius: 8,
                            border: "2px solid var(--cream-dark)",
                            background: "var(--cream)",
                            fontSize: 14,
                          }}
                        />
                        <input
                          name="lastName"
                          defaultValue={scout.lastName}
                          required
                          aria-label="Last name"
                          style={{
                            width: 100,
                            padding: "7px 10px",
                            borderRadius: 8,
                            border: "2px solid var(--cream-dark)",
                            background: "var(--cream)",
                            fontSize: 14,
                          }}
                        />
                        <SaveButton className="btn btn-quiet btn-small">Save</SaveButton>
                      </form>
                    ) : (
                      `${scout.firstName} ${scout.lastName}`
                    )}
                  </td>
                  <td data-label="Progress">
                    {scout.requiredDone}/{scout.requiredTotal} required · {scout.electivesDone}/
                    {scout.electivesRequired}+ electives
                  </td>
                  {isFullAdmin && (
                    <td className="actions">
                      <form action={setScoutActiveAction}>
                        <input type="hidden" name="scoutId" value={scout.id} />
                        <input type="hidden" name="active" value="false" />
                        <ConfirmSubmitButton
                          className="btn btn-quiet btn-small"
                          pendingLabel="Saving…"
                          message={`Mark ${scout.firstName} ${scout.lastName} inactive? They'll be hidden from this roster, advancement and attendance until you mark them active again. Nothing is deleted.`}
                        >
                          Mark Inactive
                        </ConfirmSubmitButton>
                      </form>
                      <form action={removeScoutAction}>
                        <input type="hidden" name="scoutId" value={scout.id} />
                        <input type="hidden" name="denId" value={den.id} />
                        <ConfirmSubmitButton
                          className="btn btn-danger btn-small"
                          pendingLabel="Removing…"
                          message={`Delete ${scout.firstName} ${scout.lastName}? This removes their advancement, attendance, dues, and parent contacts too — it can't be undone.`}
                        >
                          Remove
                        </ConfirmSubmitButton>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}

        {isFullAdmin && inactiveScouts.length > 0 && (
          <details style={{ marginBottom: 20 }}>
            <summary className="den-toggle">Inactive Scouts ({inactiveScouts.length})</summary>
            <p className="form-note" style={{ margin: "8px 0 12px" }}>
              Hidden from this roster, advancement and attendance. Everything they&apos;ve earned and been marked for
              is still on file — mark them active to put them back.
            </p>
            {inactiveScouts.map((scout) => (
              <div
                key={scout.id}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}
              >
                <span>
                  {scout.firstName} {scout.lastName}
                </span>
                <form action={setScoutActiveAction}>
                  <input type="hidden" name="scoutId" value={scout.id} />
                  <input type="hidden" name="active" value="true" />
                  <button type="submit" className="btn btn-quiet btn-small">
                    Mark Active
                  </button>
                </form>
              </div>
            ))}
          </details>
        )}

        {canAddScouts && (
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
