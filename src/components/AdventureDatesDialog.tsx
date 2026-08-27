"use client";

import { useEffect, useRef, useState } from "react";
import { todayDateOnlyString } from "@/lib/dateOnly";

export type AdventureDates = { completedDate: string; awardedDate: string | null };

/*
 * Prompts for the two dates that go with a completed adventure. Mounting it
 * opens it (the parent renders it only while a row is being edited), so the
 * close paths all run through onCancel/onSave rather than an `open` prop.
 */
export default function AdventureDatesDialog({
  scoutName,
  adventureName,
  initial,
  onSave,
  onCancel,
}: {
  scoutName: string;
  adventureName: string;
  /** Null when the box was just checked — a fresh completion defaults to today. */
  initial: { completedDate: string | null; awardedDate: string | null } | null;
  onSave: (dates: AdventureDates) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const savedRef = useRef(false);
  const [completedDate, setCompletedDate] = useState(initial?.completedDate ?? todayDateOnlyString());
  const [awardedDate, setAwardedDate] = useState(initial?.awardedDate ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!completedDate) {
      setError("Enter the date the scout finished this adventure.");
      return;
    }
    if (awardedDate && awardedDate < completedDate) {
      setError("The award date can't be before the completion date.");
      return;
    }
    savedRef.current = true;
    onSave({ completedDate, awardedDate: awardedDate || null });
  }

  return (
    <dialog
      ref={dialogRef}
      className="dates-dialog"
      // Fires on Esc and on a backdrop dismiss; a save unmounts us first.
      onClose={() => {
        if (!savedRef.current) onCancel();
      }}
    >
      <form onSubmit={handleSubmit}>
        <div className="eyebrow">{scoutName}</div>
        <h3>{adventureName}</h3>

        <div className="form-field">
          <label htmlFor="adv-completed-date">Date Completed</label>
          <input
            id="adv-completed-date"
            type="date"
            required
            autoFocus
            value={completedDate}
            onChange={(e) => {
              setCompletedDate(e.target.value);
              setError(null);
            }}
          />
        </div>

        <div className="form-field">
          <label htmlFor="adv-awarded-date">Date Awarded (optional)</label>
          <input
            id="adv-awarded-date"
            type="date"
            value={awardedDate}
            onChange={(e) => {
              setAwardedDate(e.target.value);
              setError(null);
            }}
          />
          <p className="form-note">
            Leave blank if the badge hasn&apos;t been presented yet. Both dates stay editable —
            the &ldquo;Edit dates&rdquo; link under this adventure reopens this box any time.
          </p>
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="dates-dialog-actions">
          <button type="button" className="btn btn-quiet btn-small" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-small">
            Save Dates
          </button>
        </div>
        <p className="form-note dates-dialog-foot">
          Nothing is written until you press Apply Changes on the scout&apos;s card.
        </p>
      </form>
    </dialog>
  );
}
