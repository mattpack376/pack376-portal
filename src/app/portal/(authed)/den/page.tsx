import { redirect } from "next/navigation";
import { requireSession } from "@/lib/authorize";
import { getDenChecklist } from "@/lib/denData";
import { denDisplayName } from "@/lib/rankConfig";
import ScoutChecklist from "@/components/ScoutChecklist";
import DenSwitcher from "@/components/DenSwitcher";

export default async function DenPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ denId?: string }>;
}) {
  const session = await requireSession();
  if (session.role !== "DEN" || session.denIds.length === 0) {
    redirect("/portal/admin");
  }

  const { denId: requestedDenId } = await searchParams;
  const denId = requestedDenId && session.denIds.includes(requestedDenId) ? requestedDenId : session.denIds[0];

  const data = await getDenChecklist(denId);
  if (!data) {
    return <div className="info-card">Your den could not be found. Contact an admin.</div>;
  }

  const { den, scouts } = data;

  return (
    <>
      <div className="section-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div className="eyebrow">My Den</div>
          <h2>{denDisplayName(den.rank, den.scoutingYear, den.label)}</h2>
          <p>Tap an adventure to mark it complete.</p>
        </div>
        <span className="badge-pill badge-den" style={{ whiteSpace: "nowrap" }}>
          {scouts.length} scout{scouts.length === 1 ? "" : "s"}
        </span>
      </div>
      <DenSwitcher denIds={session.denIds} currentDenId={denId} basePath="/portal/den" />
      <ScoutChecklist scouts={scouts} editable />
    </>
  );
}
