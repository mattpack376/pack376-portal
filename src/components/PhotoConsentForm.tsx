"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { submitPhotoConsentAction, type SubmitConsentState } from "@/lib/actions/photoConsent";
import ConsentStatusBadge from "@/components/ConsentStatusBadge";
import { formatLongDate } from "@/lib/dateOnly";
import { RELATIONSHIP_LABELS } from "@/lib/photoConsentLabels";
import type { ConsentStatus, SignerRelationship } from "@/generated/prisma/enums";

const initialState: SubmitConsentState = {};

/** signedDate comes in as YYYY-MM-DD (what <input type="date"> needs); parsed as UTC so the preview never drifts a day off. */
function formatSignedDate(iso: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  return formatLongDate(new Date(`${iso}T00:00:00Z`));
}

const VENUES: { key: "facebook" | "website" | "fliers"; label: string; note: string }[] = [
  {
    key: "facebook",
    label: "Instagram and/or Facebook",
    note: "Public posts and photo albums on the pack's Instagram and Facebook pages.",
  },
  { key: "website", label: "Pack Website", note: "Photo galleries and event recaps on the pack's public website." },
  {
    key: "fliers",
    label: "Printed Fliers",
    note: "Printed event fliers and recruitment materials handed out in person.",
  },
];

function ChoiceGroup({
  name,
  label,
  note,
  defaultValue,
}: {
  name: string;
  label: string;
  note: string;
  defaultValue?: ConsentStatus;
}) {
  return (
    <div className="form-field">
      <label>{label}</label>
      <p className="form-note" style={{ marginTop: -4, marginBottom: 4 }}>
        {note}
      </p>
      <div className="consent-choice-group">
        <label>
          <input type="radio" name={name} value="CONSENT" required defaultChecked={defaultValue === "CONSENT"} />
          Consent
        </label>
        <label>
          <input type="radio" name={name} value="DECLINE" required defaultChecked={defaultValue === "DECLINE"} />
          Decline
        </label>
      </div>
    </div>
  );
}

export default function PhotoConsentForm({
  token,
  scoutFirstName,
  facebook,
  website,
  fliers,
  signedByName,
  signedRelationship,
  signedDate,
}: {
  token: string;
  scoutFirstName: string;
  facebook: ConsentStatus;
  website: ConsentStatus;
  fliers: ConsentStatus;
  signedByName: string | null;
  signedRelationship: SignerRelationship | null;
  signedDate: string;
}) {
  const [state, formAction, pending] = useActionState(submitPhotoConsentAction, initialState);
  const [dateValue, setDateValue] = useState(signedDate);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Same popup pattern as TripRegistrationForm: pushing the saved state out to
  // the <dialog> DOM API is the one thing here that belongs in an effect.
  useEffect(() => {
    if (state.saved) dialogRef.current?.showModal();
  }, [state.saved]);

  const confirmation = state.saved && (
    <dialog ref={dialogRef} className="confirm-dialog">
      <p style={{ fontSize: 32, margin: "0 0 8px" }}>✅</p>
      <h3>Photo Consent Submitted</h3>
      <p>Thank you — we&apos;ve saved your answers for {scoutFirstName}:</p>
      <p style={{ lineHeight: 2.2 }}>
        <ConsentStatusBadge label="Instagram/Facebook" status={state.saved.facebook} />
        <ConsentStatusBadge label="Website" status={state.saved.website} />
        <ConsentStatusBadge label="Fliers" status={state.saved.fliers} />
      </p>
      <p className="form-note">If you need to change your answer later, ask your den leader for a new link.</p>
      <button
        type="button"
        onClick={() => dialogRef.current?.close()}
        className="btn btn-primary"
        style={{ width: "100%", marginTop: 8 }}
      >
        Close
      </button>
    </dialog>
  );

  // The submission rotated the token, so this link is spent — swap the form
  // (and its "please let us know" intro) out rather than leave it there to be
  // resubmitted into a "link isn't valid" error (React's post-submit form
  // reset also blanks the radios, which made it look like nothing had been
  // saved).
  if (state.saved) {
    return (
      <>
        <div className="form-success">
          Saved — thank you. This link has now been used; if you need to change your answer later, ask your den leader
          for a new one.
        </div>
        {confirmation}
      </>
    );
  }

  return (
    <>
      <p className="sub">
        Please let us know whether we can use photos of <strong>{scoutFirstName}</strong> in each of the following
        places.
      </p>
      <form action={formAction}>
        <input type="hidden" name="token" value={token} />

        {VENUES.map((venue) => (
          <ChoiceGroup
            key={venue.key}
            name={venue.key}
            label={venue.label}
            note={venue.note}
            defaultValue={venue.key === "facebook" ? facebook : venue.key === "website" ? website : fliers}
          />
        ))}

        <div className="form-field">
          <label htmlFor="signedByName">Your Name</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              id="signedByName"
              name="signedByName"
              type="text"
              defaultValue={signedByName ?? ""}
              placeholder="Parent / guardian name"
              required
              style={{ flex: 2 }}
            />
            <select
              id="signedRelationship"
              name="signedRelationship"
              defaultValue={signedRelationship ?? ""}
              required
              style={{ flex: 1 }}
            >
              <option value="" disabled>
                Relationship
              </option>
              {Object.entries(RELATIONSHIP_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-field">
          <label htmlFor="signedDate">Date</label>
          <input
            id="signedDate"
            name="signedDate"
            type="date"
            value={dateValue}
            onChange={(e) => setDateValue(e.target.value)}
            required
          />
          <p className="form-note" style={{ marginTop: 4 }}>
            {formatSignedDate(dateValue)}
          </p>
        </div>

        {state?.error && <div className="form-error">{state.error}</div>}

        <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={pending}>
          {pending ? "Saving…" : `Save Photo Consent for ${scoutFirstName}`}
        </button>
      </form>
    </>
  );
}
