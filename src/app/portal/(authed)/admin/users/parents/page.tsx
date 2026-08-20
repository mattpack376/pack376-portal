import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { denDisplayName } from "@/lib/rankConfig";
import { requireAdminSession } from "@/lib/authorize";
import { formatPhoneNumber } from "@/lib/phone";
import ResetPasswordButton from "@/components/ResetPasswordButton";
import UsersSubNav from "@/components/UsersSubNav";
import CreateParentForm from "@/components/CreateParentForm";
import { RANK_ORDER } from "@/lib/rankConfig";

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

  const scoutRows = await prisma.scout.findMany({
    include: { den: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  // Roster order (Lion -> Arrow of Light, newest year first) rather than
  // alphabetical by den name, matching how dens are listed everywhere else.
  const scoutOptions = scoutRows
    .slice()
    .sort((a, b) => {
      if (a.den.scoutingYear !== b.den.scoutingYear) return b.den.scoutingYear.localeCompare(a.den.scoutingYear);
      return RANK_ORDER.indexOf(a.den.rank) - RANK_ORDER.indexOf(b.den.rank);
    })
    .map((s) => ({
      id: s.id,
      name: `${s.firstName} ${s.lastName}`,
      den: denDisplayName(s.den.rank, s.den.scoutingYear, s.den.label),
    }));

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
                {user.parentContacts.length > 0 ? (
                  user.parentContacts
                    .map(
                      (c) =>
                        `${c.scout.firstName} ${c.scout.lastName} (${denDisplayName(
                          c.scout.den.rank,
                          c.scout.den.scoutingYear,
                          c.scout.den.label
                        )})`
                    )
                    .join(", ")
                ) : (
                  <span className="badge-pill badge-photographer" title="This login isn't attached to any scout — likely left over after its last scout was removed. Consider deleting it from Manage.">
                    No scouts attached
                  </span>
                )}
              </td>
              <td>{user.lockedUntil && user.lockedUntil.getTime() > now ? "🔒 Locked" : "Active"}</td>
              <td className="actions">
                <ResetPasswordButton userId={user.id} />
                <Link
                  className="btn btn-quiet btn-small"
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

      <div className="info-card" style={{ maxWidth: 460, marginTop: 24 }}>
        <h3>Create a Parent Account</h3>
        <p className="form-note" style={{ marginBottom: 16 }}>
          For a guardian who isn&apos;t on a scout&apos;s roster contacts yet, or who needs a second login. If they
          already have a contact with an email on file, Roster &rarr; Parents has an Invite button that does this
          and links them in one step.
        </p>
        <CreateParentForm scouts={scoutOptions} />
      </div>
    </>
  );
}
