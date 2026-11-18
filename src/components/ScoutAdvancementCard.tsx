"use client";

import { useState, useTransition } from "react";
import { applyAdventureChangesAction } from "@/lib/actions/advancement";
import type { ChecklistScout } from "@/lib/denData";
import AdventureCheckbox from "@/components/AdventureCheckbox";
import AdventureDatesDialog, { type AdventureDates } from "@/components/AdventureDatesDialog";
import AdventureRequirements, { sameDraft, type RequirementDraft } from "@/components/AdventureRequirements";
import { todayDateOnlyString } from "@/lib/dateOnly";

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
  collapsible = false,
}: {
  scout: ChecklistScout;
  editable: boolean;
  collapsible?: boolean;
}) {
  const initial = () =>
    Object.fromEntries(
      scout.adventures.map((a) => [
        a.id,
        { completed: a.completed, completedDate: a.completedDate, awardedDate: a.awardedDate },
      ])
    ) as Record<string, DraftRecord>;

  const initialRequirements = () =>
    Object.fromEntries(
      scout.adventures.flatMap((a) =>
        a.requirements.map((r) => [r.id, { completed: r.completed, completedDate: r.completedDate }])
      )
    ) as Record<string, RequirementDraft>;

  const [savedState, setSavedState] = useState<Record<string, DraftRecord>>(initial);
  const [draftState, setDraftState] = useState(savedState);
  const [savedRequirements, setSavedRequirements] = useState(initialRequirements);
  const [draftRequirements, setDraftRequirements] = useState(savedRequirements);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** Adventure whose date dialog is open, if any. */
  const [dialogAdventureId, setDialogAdventureId] = useState<string | null>(null);
  /** Completion date to suggest when the dialog opens from "All requirements met". */
  const [dialogPrefill, setDialogPrefill] = useState<string | null>(null);

  const dirtyIds = scout.adventures
    .map((a) => a.id)
    .filter((id) => !sameRecord(draftState[id], savedState[id]));
  const dirtyRequirementIds = Object.keys(draftRequirements).filter(
    (id) => !sameDraft(draftRequirements[id], savedRequirements[id])
  );
  const changeCount = dirtyIds.length + dirtyRequirementIds.length;
  const isDirty = changeCount > 0;

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
      setDialogPrefill(null);
      setDialogAdventureId(adventureId);
    }
  }

  function handleEditDates(adventureId: string) {
    if (!editable) return;
    setError(null);
    setDialogPrefill(null);
    setDialogAdventureId(adventureId);
  }

  /** From "All requirements met": the usual dates dialog, dated to the last requirement done. */
  function handleMarkComplete(adventureId: string, completedDate: string | null) {
    if (!editable) return;
    setError(null);
    setDialogPrefill(completedDate);
    setDialogAdventureId(adventureId);
  }

  /*
   * A requirement check goes into the draft dated today, no dialog — the date
   * input beside it changes that. Re-checking one that was saved as done
   * brings back its saved date. Unchecking an adventure leaves these alone.
   */
  function handleRequirementToggle(requirementId: string) {
    if (!editable) return;
    setError(null);
    setDraftRequirements((prev) => {
      const saved = savedRequirements[requirementId];
      const next: RequirementDraft = prev[requirementId]?.completed
        ? { completed: false, completedDate: null }
        : { completed: true, completedDate: saved?.completed ? saved.completedDate : todayDateOnlyString() };
      return { ...prev, [requirementId]: next };
    });
  }

  function handleRequirementDate(requirementId: string, date: string) {
    if (!editable) return;
    setError(null);
    setDraftRequirements((prev) => ({ ...prev, [requirementId]: { completed: true, completedDate: date || null } }));
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
    setDraftRequirements(savedRequirements);
    setError(null);
  }

  function handleApply() {
    if (!isDirty || isPending) return;
    const changes = dirtyIds.map((adventureId) => ({ adventureId, ...draftState[adventureId] }));
    const requirementChanges = dirtyRequirementIds.map((requirementId) => ({
      requirementId,
      ...draftRequirements[requirementId],
    }));
    if (requirementChanges.some((r) => r.completed && !r.completedDate)) {
      setError("Enter a date for every requirement you check.");
      return;
    }
    const appliedAdventures = draftState;
    const appliedRequirements = draftRequirements;
    startTransition(async () => {
      try {
        const result = await applyAdventureChangesAction(scout.id, changes, requirementChanges);
        if (result.ok) {
          setSavedState(appliedAdventures);
          setSavedRequirements(appliedRequirements);
          setError(null);
        } else {
          // Nothing was saved: the server checks the whole Apply before
          // writing any of it, so the draft stays as it is to fix or discard.
          setError(result.error);
        }
      } catch {
        // A dropped connection or a server error, rather than the error page.
        setError("Save failed — check your connection and try again.");
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
    >
      <AdventureRequirements
        adventure={adv}
        adventureChecked={draftState[adv.id].completed}
        draft={draftRequirements}
        saved={savedRequirements}
        editable={editable}
        disabled={isPending}
        onToggle={handleRequirementToggle}
        onDateChange={handleRequirementDate}
        onMarkComplete={(date) => handleMarkComplete(adv.id, date)}
      />
    </AdventureCheckbox>
  );

  const pill = (
    <span className="progress-pill">
      {rankComplete
        ? "🏅 Rank Complete"
        : `${requiredDone}/${required.length} required · ${electivesDone}/${scout.electivesRequired}+ electives`}
    </span>
  );

  const body = (
    <>
      <div className="adventure-group-label">Required Adventures</div>
      <div className="adventure-checklist">{required.map(renderAdventure)}</div>

      <div className="adventure-group-label">
        Elective Adventures ({electivesDone}/{scout.electivesRequired}+ needed)
      </div>
      <div className="adventure-checklist">{electives.map(renderAdventure)}</div>

      {editable && (
        <div className="advancement-apply-row">
          {error && (
            <span className="advancement-apply-error" role="alert">
              {error}
            </span>
          )}
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
            {isPending ? "Saving…" : isDirty ? `Apply Changes (${changeCount})` : "Apply Changes"}
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
              : dialogPrefill
                ? { completedDate: dialogPrefill, awardedDate: null }
                : null
          }
          onSave={(dates) => handleDialogSave(dialogAdventure.id, dates)}
          onCancel={() => setDialogAdventureId(null)}
        />
      )}
    </>
  );

  if (collapsible) {
    return (
      <details className="scout-card scout-card-collapsible">
        <summary className="scout-card-summary">
          <span className="scout-card-name">
            {scout.firstName} {scout.lastName}
          </span>
          {isDirty && <span className="scout-card-unsaved">Unsaved changes</span>}
          {pill}
        </summary>
        <div className="scout-card-body">{body}</div>
      </details>
    );
  }

  return (
    <div className="scout-card">
      <div className="scout-card-head">
        <h3>
          {scout.firstName} {scout.lastName}
        </h3>
        {pill}
      </div>

      {body}
    </div>
  );
}
