"use client";

import { useEffect, useRef, useState } from "react";
import { formatDateOnly, todayDateOnlyString } from "@/lib/dateOnly";
import { awardDateProblem, completedAfter } from "@/lib/pendingAwardsRules";

export type AwardDialogItem = { key: string; adventureName: string; completedDate: string };

/*
 * "Award all pending" on a scout's card: one award date for every adventure
 * that scout has finished but not been handed yet. Mounting it opens it, like
 * AdventureDatesDialog. Saving here is the confirmation — it writes straight
 * away (awardPendingAction), unlike the card's own checkboxes, which wait for
 * Apply Changes.
 */
export default function AwardDateDialog({
  scoutName,
  items,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  scoutName: string;
  items: AwardDialogItem[];
  pending: boolean;
  error: string | null;
  onConfirm: (awardedDate: string) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const today = todayDateOnlyString();
  const [awardedDate, setAwardedDate] = useState(today);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const problem = awardDateProblem(awardedDate, today);
  const skipped = problem ? [] : completedAfter(items, awardedDate);
  const count = items.length - skipped.length;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (problem) {
      setLocalError(problem);
      return;
    }
    if (count === 0) {
      setLocalError("Every one of these was completed after that date — pick a later award date.");
      return;
    }
    onConfirm(awardedDate);
  }

  return (
    <dialog
      ref={dialogRef}
      className="dates-dialog"
      // Esc can't close it mid-save; otherwise Esc or a backdrop dismiss cancels.
      onCancel={(event) => {
        if (pending) event.preventDefault();
      }}
      onClose={onCancel}
    >
      <form onSubmit={handleSubmit}>
        <div className="eyebrow">{scoutName}</div>
        <h3>Award all pending</h3>
        <ul className="award-dialog-list">
          {items.map((item) => (
            <li key={item.key} className={skipped.includes(item) ? "award-skip" : undefined}>
              <span className="award-name">{item.adventureName}</span>
              <span className="form-note">
                completed {formatDateOnly(item.completedDate)}
                {skipped.includes(item) ? " — after the award date, will be skipped" : ""}
              </span>
            </li>
          ))}
        </ul>

        <div className="form-field">
          <label htmlFor="award-all-date">Date Awarded</label>
          <input
            id="award-all-date"
            type="date"
            required
            max={today}
            value={awardedDate}
            onChange={(e) => {
              setAwardedDate(e.target.value);
              setLocalError(null);
            }}
          />
          <p className="form-note">The day the badges were handed out. Can&apos;t be in the future.</p>
        </div>

        {(localError || error) && (
          <p className="form-error" role="alert">
            {localError || error}
          </p>
        )}

        <div className="dates-dialog-actions">
          <button type="button" className="btn btn-quiet btn-small" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-small" disabled={pending || !!problem || count === 0}>
            {pending ? "Saving…" : `Mark ${count} as Awarded`}
          </button>
        </div>
        <p className="form-note dates-dialog-foot">This saves right away. You can undo it from the card afterwards.</p>
      </form>
    </dialog>
  );
}
