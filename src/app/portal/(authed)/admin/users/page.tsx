import { prisma } from "@/lib/prisma";
import { denDisplayName } from "@/lib/rankConfig";
import ResetPasswordButton from "@/components/ResetPasswordButton";
import CreateAdminForm from "@/components/CreateAdminForm";

export default async function AdminUsersPage() {
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
        <p>Every admin and den login for the pack. Resetting a password immediately invalidates the old one.</p>
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
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.username}</td>
              <td>
                <span className={`badge-pill ${user.role === "ADMIN" ? "badge-admin" : "badge-den"}`}>
                  {user.role === "ADMIN" ? "Admin" : "Den"}
                </span>
              </td>
              <td>{user.displayName}</td>
              <td>{user.den ? denDisplayName(user.den.rank, user.den.scoutingYear, user.den.label) : "—"}</td>
              <td>
                {user.lockedUntil && user.lockedUntil.getTime() > now ? "🔒 Locked" : "Active"}
              </td>
              <td className="actions">
                <ResetPasswordButton userId={user.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="info-card" style={{ maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>Add an Admin</h3>
        <CreateAdminForm />
      </div>
    </>
  );
}
