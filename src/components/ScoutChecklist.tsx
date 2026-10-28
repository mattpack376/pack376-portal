import ScoutAdvancementCard from "@/components/ScoutAdvancementCard";
import type { ChecklistScout } from "@/lib/denData";

export default function ScoutChecklist({
  scouts,
  editable,
  collapsible = false,
}: {
  scouts: ChecklistScout[];
  editable: boolean;
  /** Start each scout folded up to a one-line summary, so a long roster doesn't fill the screen. */
  collapsible?: boolean;
}) {
  if (scouts.length === 0) {
    return <div className="info-card">No scouts on this roster yet.</div>;
  }

  return (
    <div className="scout-checklist">
      {scouts.map((scout) => (
        <ScoutAdvancementCard key={scout.id} scout={scout} editable={editable} collapsible={collapsible} />
      ))}
    </div>
  );
}
