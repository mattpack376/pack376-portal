"use client";

import { useActionState, useState } from "react";
import { submitPhotoConsentAction, type SubmitConsentState } from "@/lib/actions/photoConsent";
import type { ConsentStatus, SignerRelationship } from "@/generated/prisma/enums";

const initialState: SubmitConsentState = {};

const RELATIONSHIP_OPTIONS: { value: SignerRelationship; label: string }[] = [
  { value: "PARENT", label: "Parent" },
  { value: "GUARDIAN", label: "Guardian" },
  { value: "GRANDPARENT", label: "Grandparent" },
  { value: "AUNT_UNCLE", label: "Aunt/Uncle" },
  { value: "ADULT_SIBLING", label: "Adult Sibling (18+)" },
];

/** signedDate comes in as YYYY-MM-DD (what <input type="date"> needs); parsed as UTC so the preview never drifts a day off. */
function formatSignedDate(iso: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
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
            {RELATIONSHIP_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
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
      {state?.saved && <div className="form-success">Saved — thank you. You can revisit this link any time to change your answer.</div>}

      <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={pending}>
        {pending ? "Saving…" : `Save Photo Consent for ${scoutFirstName}`}
      </button>
    </form>
  );
}
