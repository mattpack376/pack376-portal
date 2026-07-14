"use client";

import { useActionState } from "react";
import { submitPhotoConsentAction, type SubmitConsentState } from "@/lib/actions/photoConsent";
import type { ConsentStatus } from "@/generated/prisma/enums";

const initialState: SubmitConsentState = {};

const VENUES: { key: "facebook" | "website" | "fliers"; label: string; note: string }[] = [
  { key: "facebook", label: "Facebook", note: "Public posts and photo albums on the pack's Facebook page." },
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
}: {
  token: string;
  scoutFirstName: string;
  facebook: ConsentStatus;
  website: ConsentStatus;
  fliers: ConsentStatus;
  signedByName: string | null;
}) {
  const [state, formAction, pending] = useActionState(submitPhotoConsentAction, initialState);

  return (
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
        <input
          id="signedByName"
          name="signedByName"
          type="text"
          defaultValue={signedByName ?? ""}
          placeholder="Parent / guardian name"
          required
        />
      </div>

      {state?.error && <div className="form-error">{state.error}</div>}
      {state?.saved && <div className="form-success">Saved — thank you. You can revisit this link any time to change your answer.</div>}

      <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={pending}>
        {pending ? "Saving…" : `Save Photo Consent for ${scoutFirstName}`}
      </button>
    </form>
  );
}
