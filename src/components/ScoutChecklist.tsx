import ScoutAdvancementCard from "@/components/ScoutAdvancementCard";
import type { ChecklistScout } from "@/lib/denData";

export default function ScoutChecklist({
  scouts,
  editable,
}: {
  scouts: ChecklistScout[];
  editable: boolean;
}) {
  if (scouts.length === 0) {
    return <div className="info-card">No scouts on this roster yet.</div>;
  }

  return (
    <div className="scout-checklist">
      {scouts.map((scout) => (
        <ScoutAdvancementCard key={scout.id} scout={scout} editable={editable} />
      ))}
    </div>
  );
}
