import Link from "next/link";
import { requireSession, homeForRole } from "@/lib/authorize";
import ParentDashboardView from "@/components/ParentDashboardView";

/**
 * A staff account's own child. Den leaders, admins, and other staff are often
 * parents in the pack too; linking their account to a scout (admin Users >
 * Manage > Linked Children) lets them see that child's family side without a
 * second Parent Portal login.
 *
 * Read-only: the self-registration actions on the Parent Dashboard check for
 * role PARENT, so the buttons are hidden here rather than left to fail on
 * submit. Signing up their own child for an event still goes through the
 * admin side, which staff already have.
 */
export default async function MyFamilyPage() {
  const session = await requireSession();

  // PARENT already has this at /portal/parent, with the write controls.
  if (session.role === "PARENT") return <div className="info-card">Your dashboard is at <Link href="/portal/parent">Dashboard</Link>.</div>;

  if (session.scoutIds.length === 0) {
    return (
      <div className="info-card">
        <h3>No child linked to your account</h3>
        <p style={{ marginBottom: 0 }}>
          An admin can link your scout from Users &rarr; your account &rarr; Linked Children. If one was just
          linked, sign out and back in — the link is read at sign-in.{" "}
          <Link href={homeForRole(session.role)}>Back to the portal</Link>
        </p>
      </div>
    );
  }

  return (
    <ParentDashboardView
      scoutIds={session.scoutIds}
      userId={session.userId}
      displayName={session.displayName}
      readOnly
    />
  );
}
