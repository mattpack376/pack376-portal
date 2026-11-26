"use client";

import { useEffect, useRef, useState } from "react";
import { formatDateOnly, todayDateOnlyString } from "@/lib/dateOnly";
import { awardDateProblem } from "@/lib/pendingAwardsRules";

/*
 * Sets or changes the award date of a scout's rank badge from their card.
 * Mounting it opens it, like AwardDateDialog; saving writes straight away
 * (setRankAwardAction). The date can't be in the future or before the badge
 * was earned — the server checks both again.
 */
export default function RankAwardDialog({
  scoutName,
  badgeName,
  earnedDate,
  initialDate,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  scoutName: string;
  /** "Wolf rank badge". */
  badgeName: string;
  /** YYYY-MM-DD, or null when it isn't known (an adventure has no completion date, or the badge is no longer earned). */
  earnedDate: string | null;
  /** The current award date when changing it. */
  initialDate: string | null;
  pending: boolean;
  error: string | null;
  onConfirm: (awardedDate: string) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const today = todayDateOnlyString();
  const [awardedDate, setAwardedDate] = useState(initialDate ?? today);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const problem =
    awardDateProblem(awardedDate, today) ??
    (earnedDate && awardedDate < earnedDate ? `The award date can't be before it was earned (${formatDateOnly(earnedDate)}).` : null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (problem) {
      setLocalError(problem);
      return;
    }
    onConfirm(awardedDate);
  }

  return (
    <dialog
      ref={dialogRef}
      className="dates-dialog"
      onCancel={(event) => {
        if (pending) event.preventDefault();
      }}
      onClose={onCancel}
    >
      <form onSubmit={handleSubmit}>
        <div className="eyebrow">{scoutName}</div>
        <h3>{initialDate ? `Change the ${badgeName} award date` : `Award the ${badgeName}`}</h3>
        {earnedDate && <p className="form-note">Earned {formatDateOnly(earnedDate)}.</p>}

        <div className="form-field">
          <label htmlFor="rank-award-date">Date Awarded</label>
          <input
            id="rank-award-date"
            type="date"
            required
            min={earnedDate ?? undefined}
            max={today}
            value={awardedDate}
            onChange={(e) => {
              setAwardedDate(e.target.value);
              setLocalError(null);
            }}
          />
          <p className="form-note">The day the badge was handed out. Can&apos;t be in the future.</p>
        </div>

        {/* A date the server would refuse says why at once, not just a greyed-out Save. */}
        {(localError || error || problem) && (
          <p className="form-error" role="alert">
            {localError || error || problem}
          </p>
        )}

        <div className="dates-dialog-actions">
          <button type="button" className="btn btn-quiet btn-small" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-small" disabled={pending || !!problem}>
            {pending ? "Saving…" : "Save award date"}
          </button>
        </div>
        <p className="form-note dates-dialog-foot">This saves right away.</p>
      </form>
    </dialog>
  );
}
