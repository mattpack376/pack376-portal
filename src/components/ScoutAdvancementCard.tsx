"use client";

import { useState, useTransition } from "react";
import { applyAdventureChangesAction } from "@/lib/actions/advancement";
import type { ChecklistScout } from "@/lib/denData";
import AdventureCheckbox from "@/components/AdventureCheckbox";
import AdventureDatesDialog, { type AdventureDates } from "@/components/AdventureDatesDialog";

/** One row's draft state: what Apply Changes will write. */
type DraftRecord = { completed: boolean; completedDate: string | null; awardedDate: string | null };

function sameRecord(a: DraftRecord, b: DraftRecord) {
  return (
    a.completed === b.completed &&
    a.completedDate === b.completedDate &&
    a.awardedDate === b.awardedDate
  );
}

export default function ScoutAdvancementCard({
  scout,
  editable,
}: {
  scout: ChecklistScout;
  editable: boolean;
}) {
  const initial = () =>
    Object.fromEntries(
      scout.adventures.map((a) => [
        a.id,
        { completed: a.completed, completedDate: a.completedDate, awardedDate: a.awardedDate },
      ])
    ) as Record<string, DraftRecord>;

  const [savedState, setSavedState] = useState<Record<string, DraftRecord>>(initial);
  const [draftState, setDraftState] = useState(savedState);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** Adventure whose date dialog is open, if any. */
  const [dialogAdventureId, setDialogAdventureId] = useState<string | null>(null);

  const dirtyIds = scout.adventures
    .map((a) => a.id)
    .filter((id) => !sameRecord(draftState[id], savedState[id]));
  const isDirty = dirtyIds.length > 0;

  /*
   * Checking a box asks for the dates first — nothing enters the draft until
   * the dialog is saved. Unchecking clears both dates outright, since an
   * adventure that isn't complete can't have been completed or awarded.
   */
  function handleToggle(adventureId: string) {
    if (!editable) return;
    setError(null);
    if (draftState[adventureId].completed) {
      setDraftState((prev) => ({
        ...prev,
        [adventureId]: { completed: false, completedDate: null, awardedDate: null },
      }));
    } else {
      setDialogAdventureId(adventureId);
    }
  }

  function handleEditDates(adventureId: string) {
    if (!editable) return;
    setError(null);
    setDialogAdventureId(adventureId);
  }

  function handleDialogSave(adventureId: string, dates: AdventureDates) {
    setDraftState((prev) => ({
      ...prev,
      [adventureId]: {
        completed: true,
        completedDate: dates.completedDate,
        awardedDate: dates.awardedDate,
      },
    }));
    setDialogAdventureId(null);
  }

  function handleDiscard() {
    setDraftState(savedState);
    setError(null);
  }

  function handleApply() {
    if (!isDirty || isPending) return;
    const changes = dirtyIds.map((adventureId) => ({ adventureId, ...draftState[adventureId] }));
    startTransition(async () => {
      const result = await applyAdventureChangesAction(scout.id, changes);
      if (result.ok) {
        setSavedState(draftState);
        setError(null);
      } else {
        setError(result.error ?? "Save failed — try again.");
      }
    });
  }

  const required = scout.adventures.filter((a) => a.type === "REQUIRED");
  const electives = scout.adventures.filter((a) => a.type === "ELECTIVE");
  const requiredDone = required.filter((a) => draftState[a.id].completed).length;
  const electivesDone = electives.filter((a) => draftState[a.id].completed).length;
  const rankComplete =
    requiredDone === required.length && electivesDone >= scout.electivesRequired;
  const dialogAdventure = scout.adventures.find((a) => a.id === dialogAdventureId) ?? null;

  const renderAdventure = (adv: (typeof scout.adventures)[number]) => (
    <AdventureCheckbox
      key={adv.id}
      adventure={adv}
      checked={draftState[adv.id].completed}
      completedDate={draftState[adv.id].completedDate}
      awardedDate={draftState[adv.id].awardedDate}
      dirty={!sameRecord(draftState[adv.id], savedState[adv.id])}
      editable={editable}
      disabled={isPending}
      onToggle={() => handleToggle(adv.id)}
      onEditDates={() => handleEditDates(adv.id)}
    />
  );

  return (
    <div className="scout-card">
      <div className="scout-card-head">
        <h3>
          {scout.firstName} {scout.lastName}
        </h3>
        <span className="progress-pill">
          {rankComplete
            ? "🏅 Rank Complete"
            : `${requiredDone}/${required.length} required · ${electivesDone}/${scout.electivesRequired}+ electives`}
        </span>
      </div>

      <div className="adventure-group-label">Required Adventures</div>
      <div className="adventure-checklist">{required.map(renderAdventure)}</div>

      <div className="adventure-group-label">
        Elective Adventures ({electivesDone}/{scout.electivesRequired}+ needed)
      </div>
      <div className="adventure-checklist">{electives.map(renderAdventure)}</div>

      {editable && (
        <div className="advancement-apply-row">
          {error && <span className="advancement-apply-error">{error}</span>}
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

      {dialogAdventure && (
        <AdventureDatesDialog
          key={dialogAdventure.id}
          scoutName={`${scout.firstName} ${scout.lastName}`}
          adventureName={dialogAdventure.name}
          initial={
            draftState[dialogAdventure.id].completed
              ? {
                  completedDate: draftState[dialogAdventure.id].completedDate,
                  awardedDate: draftState[dialogAdventure.id].awardedDate,
                }
              : null
          }
          onSave={(dates) => handleDialogSave(dialogAdventure.id, dates)}
          onCancel={() => setDialogAdventureId(null)}
        />
      )}
    </div>
  );
}
