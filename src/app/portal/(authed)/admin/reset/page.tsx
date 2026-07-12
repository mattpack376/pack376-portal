import { requireMasterAdminSession } from "@/lib/authorize";
import { prisma } from "@/lib/prisma";
import ResetPackDataForm from "@/components/ResetPackDataForm";

export default async function AdminResetPage() {
  await requireMasterAdminSession();
  const scoutCount = await prisma.scout.count();

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Danger Zone</div>
        <h2>Start a Fresh Year</h2>
        <p>
          Permanently deletes every scout on every den&apos;s roster — along with their advancement
          checkmarks, attendance history, and dues payments. Dens, the meeting calendar (including
          cancelled dates), the adventure list, dues settings, and every login stay exactly as they
          are.
        </p>
      </div>

      <div className="info-card" style={{ maxWidth: 480, borderTop: "6px solid var(--carnival-red)" }}>
        <p>
          <strong>{scoutCount}</strong> scout{scoutCount === 1 ? "" : "s"} will be permanently removed.
        </p>
        <ResetPackDataForm />
      </div>
    </>
  );
}
