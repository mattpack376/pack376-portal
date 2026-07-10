import { prisma } from "@/lib/prisma";
import { denDisplayName } from "@/lib/rankConfig";
import { requireAdminSession } from "@/lib/authorize";
import { isMasterAdminUsername } from "@/lib/masterAdmins";
import ResetPasswordButton from "@/components/ResetPasswordButton";
import CreateAdminForm from "@/components/CreateAdminForm";
import RoleSelect from "@/components/RoleSelect";
import DeleteUserButton from "@/components/DeleteUserButton";

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  ATTENDANCE_ADMIN: "Attendance Only",
  DEN: "Den",
};

const ROLE_BADGE_CLASSES: Record<string, string> = {
  ADMIN: "badge-admin",
  ATTENDANCE_ADMIN: "badge-attendance",
  DEN: "badge-den",
};

export default async function AdminUsersPage() {
  await requireAdminSession();

  const users = await prisma.user.findMany({
    include: { den: true },
    orderBy: [{ role: "asc" }, { username: "asc" }],
  });
  // eslint-disable-next-line react-hooks/purity -- Server Component, runs once per request; not a client re-render purity concern.
  const now = Date.now();

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Admin</div>
        <h2>Accounts</h2>
        <p>
          Every admin and den login for the pack. Change an account&apos;s role with the dropdown, reset a
          password to invalidate the old one immediately, or delete an account outright. Master admin accounts
          (🔒) are protected from deletion and role changes here — they can only be changed in code.
        </p>
      </div>

      <table className="data-table" style={{ marginBottom: 32 }}>
        <thead>
          <tr>
            <th>Username</th>
            <th>Role</th>
            <th>Display Name</th>
            <th>Den</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const protectedAccount = isMasterAdminUsername(user.username);
            const roleEditable = !protectedAccount && (user.role === "ADMIN" || user.role === "ATTENDANCE_ADMIN");
            return (
              <tr key={user.id}>
                <td>
                  {user.username}
                  {protectedAccount && (
                    <span className="badge-pill badge-admin" style={{ marginLeft: 8 }} title="Protected master admin — can only be changed in code">
                      🔒 Master
                    </span>
                  )}
                </td>
                <td>
                  {roleEditable ? (
                    <RoleSelect userId={user.id} role={user.role as "ADMIN" | "ATTENDANCE_ADMIN"} />
                  ) : (
                    <span className={`badge-pill ${ROLE_BADGE_CLASSES[user.role]}`}>
                      {ROLE_LABELS[user.role]}
                    </span>
                  )}
                </td>
                <td>{user.displayName}</td>
                <td>{user.den ? denDisplayName(user.den.rank, user.den.scoutingYear, user.den.label) : "—"}</td>
                <td>
                  {user.lockedUntil && user.lockedUntil.getTime() > now ? "🔒 Locked" : "Active"}
                </td>
                <td className="actions">
                  <ResetPasswordButton userId={user.id} />
                  {!protectedAccount && <DeleteUserButton userId={user.id} username={user.username} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="info-card" style={{ maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>Add an Admin or Attendance-Only Account</h3>
        <CreateAdminForm />
      </div>
    </>
  );
}
