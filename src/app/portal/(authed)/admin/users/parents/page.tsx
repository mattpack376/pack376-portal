import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { denDisplayName } from "@/lib/rankConfig";
import { requireAdminSession } from "@/lib/authorize";
import { formatPhoneNumber } from "@/lib/phone";
import ResetPasswordButton from "@/components/ResetPasswordButton";
import UsersSubNav from "@/components/UsersSubNav";

export default async function AdminParentAccountsPage() {
  await requireAdminSession();

  const parents = await prisma.user.findMany({
    where: { role: "PARENT" },
    include: {
      parentContacts: {
        include: { scout: { include: { den: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ displayName: "asc" }],
  });
  // eslint-disable-next-line react-hooks/purity -- Server Component, runs once per request; not a client re-render purity concern.
  const now = Date.now();

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Admin</div>
        <h2>Accounts</h2>
        <p>Every Parent Portal login and which scouts each one can see. Resetting a password immediately invalidates the old one.</p>
      </div>

      <UsersSubNav active="parents" />

      <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Login</th>
            <th>Display Name</th>
            <th>Phone</th>
            <th>Kids Attached</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {parents.length === 0 && (
            <tr>
              <td colSpan={6}>No Parent Portal accounts yet.</td>
            </tr>
          )}
          {parents.map((user) => (
            <tr key={user.id}>
              <td>{user.username}</td>
              <td>{user.displayName}</td>
              <td>{user.phone ? formatPhoneNumber(user.phone) : "—"}</td>
              <td>
                {user.parentContacts.length > 0
                  ? user.parentContacts
                      .map(
                        (c) =>
                          `${c.scout.firstName} ${c.scout.lastName} (${denDisplayName(
                            c.scout.den.rank,
                            c.scout.den.scoutingYear,
                            c.scout.den.label
                          )})`
                      )
                      .join(", ")
                  : "—"}
              </td>
              <td>{user.lockedUntil && user.lockedUntil.getTime() > now ? "🔒 Locked" : "Active"}</td>
              <td className="actions">
                <ResetPasswordButton userId={user.id} />
                <Link
                  className="btn btn-outline btn-small"
                  style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
                  href={`/portal/admin/users/parents/${user.id}`}
                >
                  Manage
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}
