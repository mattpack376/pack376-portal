import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { denDisplayName } from "@/lib/rankConfig";
import { requireAdminSession } from "@/lib/authorize";
import { isMasterAdminUsername } from "@/lib/masterAdmins";
import type { AssignableRole } from "@/lib/roleLabels";
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
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { den: true } });
  if (!user) notFound();

  const protectedAccount = isMasterAdminUsername(user.username);
  const roleEditable = !protectedAccount && user.role !== "DEN";

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">
          <Link href="/portal/admin/users">← All Accounts</Link>
        </div>
        <h2>{user.username}</h2>
        <p>
          {user.displayName}
          {user.den ? ` · ${denDisplayName(user.den.rank, user.den.scoutingYear, user.den.label)}` : ""}
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

      {user.role === "DEN" && (
        <div className="info-card" style={{ marginBottom: 24 }}>
          <h3 style={{ marginTop: 0 }}>Permission Level</h3>
          <p style={{ marginBottom: 0 }}>
            Den Leader logins are scoped to their own den&apos;s advancement and attendance and can&apos;t be
            changed to an admin role here.
          </p>
        </div>
      )}

      <div className="info-card" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <ResetPasswordButton userId={user.id} />
        {!protectedAccount && <DeleteUserButton userId={user.id} username={user.username} />}
      </div>
    </>
  );
}
