"use client";

import { useActionState } from "react";
import { sendPhotoConsentLinkEmailAction, type SendConsentEmailState } from "@/lib/actions/photoConsent";

const initialState: SendConsentEmailState = {};

/**
 * Emails a scout's consent link to the parent address shown on the button.
 * The action only ever sends to a matching parent email it finds on file for
 * this scout, so the hidden field just says which one.
 */
export default function EmailConsentLinkButton({ scoutId, parentEmail }: { scoutId: string; parentEmail: string }) {
  const [state, formAction, pending] = useActionState(sendPhotoConsentLinkEmailAction, initialState);

  return (
    <form action={formAction} style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input type="hidden" name="scoutId" value={scoutId} />
      <input type="hidden" name="parentEmail" value={parentEmail} />
      <button type="submit" disabled={pending} className="btn btn-quiet btn-small" style={{ borderColor: "var(--teal)", color: "var(--teal)" }}>
        {pending ? "Sending…" : `Email Link to ${parentEmail}`}
      </button>
      {state?.sent && (
        <span role="status" style={{ fontSize: 13, color: "var(--teal)", fontWeight: 600 }}>
          Sent!
        </span>
      )}
      {state?.sent === false && state.configured === false && (
        <span role="status" style={{ fontSize: 13, color: "var(--ink-soft)" }}>
          Email isn&apos;t configured — copy the link instead.
        </span>
      )}
      {state?.sent === false && state.configured === true && (
        <span role="alert" style={{ fontSize: 13, color: "var(--carnival-red)" }}>
          Something went wrong sending it — copy the link instead.
        </span>
      )}
      {state?.error && (
        <span role="alert" style={{ fontSize: 13, color: "var(--carnival-red)" }}>
          {state.error}
        </span>
      )}
    </form>
  );
}
