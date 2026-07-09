import { redirect } from "next/navigation";
import { requireSession } from "@/lib/authorize";
import { getDenChecklist } from "@/lib/denData";
import { denDisplayName } from "@/lib/rankConfig";
import ScoutChecklist from "@/components/ScoutChecklist";

export default async function DenPortalPage() {
  const session = await requireSession();
  if (session.role !== "DEN" || !session.denId) {
    redirect("/portal/admin");
  }

  const data = await getDenChecklist(session.denId);
  if (!data) {
    return <div className="info-card">Your den could not be found. Contact an admin.</div>;
  }

  const { den, scouts } = data;

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">My Den</div>
        <h2>{denDisplayName(den.rank, den.scoutingYear, den.label)}</h2>
        <p>
          {scouts.length} scout{scouts.length === 1 ? "" : "s"} on your roster. Tap an adventure to
          mark it complete.
        </p>
      </div>
      <ScoutChecklist scouts={scouts} editable />
    </>
  );
}
