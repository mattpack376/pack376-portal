import AdventureCheckbox from "@/components/AdventureCheckbox";
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
      {scouts.map((scout) => {
        const required = scout.adventures.filter((a) => a.type === "REQUIRED");
        const electives = scout.adventures.filter((a) => a.type === "ELECTIVE");
        const rankComplete =
          scout.requiredDone === scout.requiredTotal && scout.electivesDone >= scout.electivesRequired;

        return (
          <div className="scout-card" key={scout.id}>
            <div className="scout-card-head">
              <h3>
                {scout.firstName} {scout.lastName}
              </h3>
              <span className="progress-pill">
                {rankComplete
                  ? "🏅 Rank Complete"
                  : `${scout.requiredDone}/${scout.requiredTotal} required · ${scout.electivesDone}/${scout.electivesRequired}+ electives`}
              </span>
            </div>

            <div className="adventure-group-label">Required Adventures</div>
            <div className="adventure-checklist">
              {required.map((adv) => (
                <AdventureCheckbox key={adv.id} scoutId={scout.id} adventure={adv} editable={editable} />
              ))}
            </div>

            <div className="adventure-group-label">
              Elective Adventures ({scout.electivesDone}/{scout.electivesRequired}+ needed)
            </div>
            <div className="adventure-checklist">
              {electives.map((adv) => (
                <AdventureCheckbox key={adv.id} scoutId={scout.id} adventure={adv} editable={editable} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
