"use client";

import { useState, useTransition } from "react";
import { applyAdventureChangesAction } from "@/lib/actions/advancement";
import type { ChecklistScout } from "@/lib/denData";
import AdventureCheckbox from "@/components/AdventureCheckbox";

export default function ScoutAdvancementCard({
  scout,
  editable,
}: {
  scout: ChecklistScout;
  editable: boolean;
}) {
  const [savedState, setSavedState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(scout.adventures.map((a) => [a.id, a.completed]))
  );
  const [checkedState, setCheckedState] = useState(savedState);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  const dirtyIds = scout.adventures
    .map((a) => a.id)
    .filter((id) => checkedState[id] !== savedState[id]);
  const isDirty = dirtyIds.length > 0;

  function handleToggle(adventureId: string) {
    if (!editable) return;
    setError(false);
    setCheckedState((prev) => ({ ...prev, [adventureId]: !prev[adventureId] }));
  }

  function handleDiscard() {
    setCheckedState(savedState);
    setError(false);
  }

  function handleApply() {
    if (!isDirty || isPending) return;
    const changes = dirtyIds.map((adventureId) => ({
      adventureId,
      completed: checkedState[adventureId],
    }));
    startTransition(async () => {
      const result = await applyAdventureChangesAction(scout.id, changes);
      if (result.ok) {
        setSavedState(checkedState);
        setError(false);
      } else {
        setError(true);
      }
    });
  }

  const required = scout.adventures.filter((a) => a.type === "REQUIRED");
  const electives = scout.adventures.filter((a) => a.type === "ELECTIVE");
  const rankComplete =
    scout.requiredDone === scout.requiredTotal && scout.electivesDone >= scout.electivesRequired;

  return (
    <div className="scout-card">
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
          <AdventureCheckbox
            key={adv.id}
            adventure={adv}
            checked={checkedState[adv.id]}
            dirty={checkedState[adv.id] !== savedState[adv.id]}
            editable={editable}
            disabled={isPending}
            onToggle={() => handleToggle(adv.id)}
          />
        ))}
      </div>

      <div className="adventure-group-label">
        Elective Adventures ({scout.electivesDone}/{scout.electivesRequired}+ needed)
      </div>
      <div className="adventure-checklist">
        {electives.map((adv) => (
          <AdventureCheckbox
            key={adv.id}
            adventure={adv}
            checked={checkedState[adv.id]}
            dirty={checkedState[adv.id] !== savedState[adv.id]}
            editable={editable}
            disabled={isPending}
            onToggle={() => handleToggle(adv.id)}
          />
        ))}
      </div>

      {editable && (
        <div className="advancement-apply-row">
          {error && <span className="advancement-apply-error">Save failed — try again.</span>}
          {isDirty && !isPending && (
            <button type="button" className="btn-link" onClick={handleDiscard}>
              Discard changes
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary btn-small"
            disabled={!isDirty || isPending}
            onClick={handleApply}
          >
            {isPending ? "Saving…" : isDirty ? `Apply Changes (${dirtyIds.length})` : "Apply Changes"}
          </button>
        </div>
      )}
    </div>
  );
}
