import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { denDisplayName, RANK_ORDER } from "@/lib/rankConfig";
import { requireAdminSession } from "@/lib/authorize";
import { isMasterAdminUsername } from "@/lib/masterAdmins";
import { updateUserDensAction, updateUserEmailAction, updateUserDisplayNameAction } from "@/lib/actions/users";
import { DEN_ASSIGNABLE_ROLES, type AssignableRole } from "@/lib/roleLabels";
import type { Rank } from "@/generated/prisma/enums";
import ResetPasswordButton from "@/components/ResetPasswordButton";
import DeleteUserButton from "@/components/DeleteUserButton";
import ManageUserRoleForm from "@/components/ManageUserRoleForm";

export default async function ManageUserPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  await requireAdminSession();

  const { userId } = await params;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { denAssignments: { include: { den: true } } },
  });
  // Parent Portal accounts are managed from Roster → Parents instead — this
  // screen's role picker doesn't have a PARENT option.
  if (!user || user.role === "PARENT") notFound();

  const protectedAccount = isMasterAdminUsername(user.username);
  const roleEditable = !protectedAccount;
  const assignedDenIds = new Set(user.denAssignments.map((a) => a.denId));
  const canAssignDens = DEN_ASSIGNABLE_ROLES.includes(user.role as (typeof DEN_ASSIGNABLE_ROLES)[number]);

  const allDens = canAssignDens ? await prisma.den.findMany() : [];
  allDens.sort((a, b) => {
    if (a.scoutingYear !== b.scoutingYear) return b.scoutingYear.localeCompare(a.scoutingYear);
    return RANK_ORDER.indexOf(a.rank as Rank) - RANK_ORDER.indexOf(b.rank as Rank);
  });
  const denYears = Array.from(new Set(allDens.map((d) => d.scoutingYear)));

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">
          <Link href="/portal/admin/users">← All Accounts</Link>
        </div>
        <h2>{user.username}</h2>
        <p>
          {user.displayName}
          {user.denAssignments.length > 0
            ? ` · ${user.denAssignments
                .map((a) => denDisplayName(a.den.rank, a.den.scoutingYear, a.den.label))
                .join(", ")}`
            : ""}
        </p>
      </div>

      {protectedAccount && (
        <div className="info-card" style={{ marginBottom: 24 }}>
          <h3 style={{ marginTop: 0 }}>🔒 Protected Master Admin</h3>
          <p style={{ marginBottom: 0 }}>
            This account&apos;s permission level can&apos;t be changed and it can&apos;t be deleted from the admin
            panel — only by editing src/lib/masterAdmins.ts in code and deploying.
          </p>
        </div>
      )}

      {roleEditable && (
        <div className="info-card" style={{ marginBottom: 24, maxWidth: 420 }}>
          <h3 style={{ marginTop: 0 }}>Permission Level</h3>
          <ManageUserRoleForm userId={user.id} role={user.role as AssignableRole} />
        </div>
      )}

      <div className="info-card" style={{ marginBottom: 24, maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>Display Name</h3>
        <form action={updateUserDisplayNameAction} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <input type="hidden" name="userId" value={user.id} />
          <div className="form-field" style={{ marginBottom: 0, flex: 1 }}>
            <label htmlFor="displayName">Display Name</label>
            <input id="displayName" name="displayName" type="text" defaultValue={user.displayName} required />
          </div>
          <button type="submit" className="btn btn-primary">Save</button>
        </form>
      </div>

      <div className="info-card" style={{ marginBottom: 24, maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>Contact Email</h3>
        <p>When set, password resets and new-account credentials are emailed here instead of shown on screen.</p>
        <form action={updateUserEmailAction} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <input type="hidden" name="userId" value={user.id} />
          <div className="form-field" style={{ marginBottom: 0, flex: 1 }}>
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" defaultValue={user.email ?? ""} />
          </div>
          <button type="submit" className="btn btn-primary">Save</button>
        </form>
      </div>

      {canAssignDens && (
        <div className="info-card" style={{ marginBottom: 24 }}>
          <h3 style={{ marginTop: 0 }}>Assigned Dens</h3>
          <p>
            {user.role === "DEN"
              ? "Check every den this leader should have advancement & attendance access to."
              : "Optional — check any den(s) this account should be listed as a leader of on the dashboard and roster. Admins and Junior Admins already have access to every den regardless."}
          </p>
          {allDens.length === 0 ? (
            <p style={{ marginBottom: 0 }}>No dens exist yet.</p>
          ) : (
            <form action={updateUserDensAction}>
              <input type="hidden" name="userId" value={user.id} />
              {denYears.map((year) => (
                <div key={year} style={{ marginBottom: 14 }}>
                  <div className="adventure-group-label">{year}</div>
                  <div className="adventure-checklist">
                    {allDens
                      .filter((den) => den.scoutingYear === year)
                      .map((den) => (
                        <label key={den.id} className="adventure-check-item">
                          <input
                            type="checkbox"
                            name="denIds"
                            value={den.id}
                            defaultChecked={assignedDenIds.has(den.id)}
                          />
                          <span>{denDisplayName(den.rank, den.scoutingYear, den.label)}</span>
                        </label>
                      ))}
                  </div>
                </div>
              ))}
              <button type="submit" className="btn btn-primary" style={{ marginTop: 8 }}>
                Save Den Assignments
              </button>
            </form>
          )}
        </div>
      )}

      <div className="info-card" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <ResetPasswordButton userId={user.id} />
        {!protectedAccount && <DeleteUserButton userId={user.id} username={user.username} />}
      </div>
    </>
  );
}
