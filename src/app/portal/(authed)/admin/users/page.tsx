import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { denDisplayName } from "@/lib/rankConfig";
import { requireAdminSession } from "@/lib/authorize";
import { ROLE_LABELS, ROLE_BADGE_CLASSES } from "@/lib/roleLabels";
import ResetPasswordButton from "@/components/ResetPasswordButton";
import CreateAdminForm from "@/components/CreateAdminForm";

export default async function AdminUsersPage() {
  await requireAdminSession();

  const users = await prisma.user.findMany({
    // Parent Portal accounts are managed from Roster → Parents, not here —
    // they don't fit this screen's role picker (Admin/Junior Admin/Attendance
    // Only/Photographer/Den Leader).
    where: { role: { not: "PARENT" } },
    include: { denAssignments: { include: { den: true } } },
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
                <span className={`badge-pill ${ROLE_BADGE_CLASSES[user.role]}`}>
                  {ROLE_LABELS[user.role]}
                </span>
              </td>
              <td>{user.displayName}</td>
              <td>
                {user.denAssignments.length > 0
                  ? user.denAssignments
                      .map((a) => denDisplayName(a.den.rank, a.den.scoutingYear, a.den.label))
                      .join(", ")
                  : "—"}
              </td>
              <td>
                {user.lockedUntil && user.lockedUntil.getTime() > now ? "🔒 Locked" : "Active"}
              </td>
              <td className="actions">
                <ResetPasswordButton userId={user.id} />
                <Link
                  className="btn btn-outline btn-small"
                  style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
                  href={`/portal/admin/users/${user.id}`}
                >
                  Manage
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="info-card" style={{ maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>Add an Admin, Junior Admin, Attendance Only, or Photographer Account</h3>
        <CreateAdminForm />
      </div>
    </>
  );
}
