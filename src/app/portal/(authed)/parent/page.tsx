import { requireParentSession } from "@/lib/authorize";
import ParentDashboardView from "@/components/ParentDashboardView";

export default async function ParentDashboardPage() {
  const session = await requireParentSession();
  return (
    <ParentDashboardView
      scoutIds={session.scoutIds}
      userId={session.userId}
      displayName={session.displayName}
    />
  );
}
