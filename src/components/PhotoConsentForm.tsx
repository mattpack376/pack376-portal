"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  submitPhotoConsentAction,
  type ConsentField,
  type SubmitConsentState,
} from "@/lib/actions/photoConsent";
import ConsentStatusBadge from "@/components/ConsentStatusBadge";
import { formatLongDate } from "@/lib/dateOnly";
import { MAX_NAME_LENGTH } from "@/lib/formValues";
import { RELATIONSHIP_LABELS } from "@/lib/photoConsentLabels";
import type { ConsentStatus, SignerRelationship } from "@/generated/prisma/enums";

const initialState: SubmitConsentState = {};

const ERROR_ID = "photo-consent-error";

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

/** The id focus moves to when the server turns a field down; a choice group's is its first radio. */
function focusId(field: ConsentField) {
  return field === "facebook" || field === "website" || field === "fliers" ? `${field}-consent` : field;
}

/** aria-invalid/aria-describedby for the field an error is about, tying it to the message. */
function errorProps(invalid: boolean) {
  return invalid ? { "aria-invalid": true as const, "aria-describedby": ERROR_ID } : {};
}

function ChoiceGroup({
  name,
  label,
  note,
  defaultValue,
  invalid,
}: {
  name: string;
  label: string;
  note: string;
  defaultValue?: string;
  invalid: boolean;
}) {
  return (
    <div className="form-field" role="radiogroup" aria-labelledby={`${name}-label`} {...errorProps(invalid)}>
      <label id={`${name}-label`}>{label}</label>
      <p className="form-note" style={{ marginTop: -4, marginBottom: 4 }}>
        {note}
      </p>
      <div className="consent-choice-group">
        <label>
          <input
            id={`${name}-consent`}
            type="radio"
            name={name}
            value="CONSENT"
            required
            defaultChecked={defaultValue === "CONSENT"}
          />
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
  const errorRef = useRef<HTMLDivElement>(null);

  // After a refusal, move focus to the field it's about (or the message
  // itself), so a keyboard or screen-reader user lands where the fix is.
  useEffect(() => {
    if (!state.error) return;
    const target = state.field ? document.getElementById(focusId(state.field)) : null;
    (target ?? errorRef.current)?.focus();
  }, [state]);

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
    <PhotoConsentFields
      state={state}
      formAction={formAction}
      pending={pending}
      token={token}
      scoutFirstName={scoutFirstName}
      onFile={{ facebook, website, fliers, signedByName, signedRelationship }}
      dateValue={dateValue}
      onDateChange={setDateValue}
      errorRef={errorRef}
    />
  );
}

/**
 * The form itself for a given action state — split out of PhotoConsentForm
 * so its markup (which field is marked invalid, what's kept after an error)
 * can be checked without a browser.
 */
export function PhotoConsentFields({
  state,
  formAction,
  pending,
  token,
  scoutFirstName,
  onFile,
  dateValue,
  onDateChange,
  errorRef,
}: {
  state: SubmitConsentState;
  formAction: (formData: FormData) => void;
  pending: boolean;
  token: string;
  scoutFirstName: string;
  /** The answers and signer already on file, shown until the parent submits. */
  onFile: {
    facebook: ConsentStatus;
    website: ConsentStatus;
    fliers: ConsentStatus;
    signedByName: string | null;
    signedRelationship: SignerRelationship | null;
  };
  dateValue: string;
  onDateChange: (value: string) => void;
  errorRef?: React.Ref<HTMLDivElement>;
}) {
  // What the parent entered, when the server sent it back with an error;
  // otherwise what's on file. React resets the form after every submit, so
  // the fields are remounted (keyed on these values) with them as defaults —
  // the reset then restores the parent's answers instead of blanking them.
  const values = state.values;
  const formKey = values ? JSON.stringify(values) : "on-file";
  const invalid = (field: ConsentField) => !!state.error && state.field === field;

  return (
    <>
      <p className="sub">
        Please let us know whether we can use photos of <strong>{scoutFirstName}</strong> in each of the following
        places.
      </p>
      <form action={formAction} key={formKey}>
        <input type="hidden" name="token" value={token} />

        {state.error && (
          <div id={ERROR_ID} ref={errorRef} className="form-error" role="alert" tabIndex={-1}>
            {state.error}
          </div>
        )}

        {VENUES.map((venue) => (
          <ChoiceGroup
            key={venue.key}
            name={venue.key}
            label={venue.label}
            note={venue.note}
            defaultValue={values ? values[venue.key] : onFile[venue.key]}
            invalid={invalid(venue.key)}
          />
        ))}

        <div className="form-field">
          <label htmlFor="signedByName">Your Name</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              id="signedByName"
              name="signedByName"
              type="text"
              defaultValue={values ? values.signedByName : (onFile.signedByName ?? "")}
              placeholder="Parent / guardian name"
              autoComplete="name"
              maxLength={MAX_NAME_LENGTH}
              required
              style={{ flex: 2, ...(invalid("signedByName") ? { borderColor: "var(--carnival-red)" } : {}) }}
              {...errorProps(invalid("signedByName"))}
            />
            <select
              id="signedRelationship"
              name="signedRelationship"
              aria-label="Your relationship to the scout"
              defaultValue={values ? values.signedRelationship : (onFile.signedRelationship ?? "")}
              required
              style={{ flex: 1, ...(invalid("signedRelationship") ? { borderColor: "var(--carnival-red)" } : {}) }}
              {...errorProps(invalid("signedRelationship"))}
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
            onChange={(e) => onDateChange(e.target.value)}
            required
            style={invalid("signedDate") ? { borderColor: "var(--carnival-red)" } : undefined}
            {...errorProps(invalid("signedDate"))}
          />
          <p className="form-note" style={{ marginTop: 4 }}>
            {formatSignedDate(dateValue)}
          </p>
        </div>

        <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={pending}>
          {pending ? "Saving…" : `Save Photo Consent for ${scoutFirstName}`}
        </button>
      </form>
    </>
  );
}
