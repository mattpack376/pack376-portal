"use client";

import { useActionState } from "react";
import { sendPhotoConsentLinkEmailAction, type SendConsentEmailState } from "@/lib/actions/photoConsent";

const initialState: SendConsentEmailState = {};

export default function EmailConsentLinkButton({ scoutId, parentEmail }: { scoutId: string; parentEmail: string }) {
  const [state, formAction, pending] = useActionState(sendPhotoConsentLinkEmailAction, initialState);

  return (
    <form action={formAction} style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input type="hidden" name="scoutId" value={scoutId} />
      <input type="hidden" name="parentEmail" value={parentEmail} />
      <button type="submit" disabled={pending} className="btn btn-outline btn-small" style={{ borderColor: "var(--teal)", color: "var(--teal)" }}>
        {pending ? "Sending…" : `Email Link to ${parentEmail}`}
      </button>
      {state?.sent && <span style={{ fontSize: 13, color: "var(--teal)", fontWeight: 600 }}>Sent!</span>}
      {state?.sent === false && !state.error && (
        <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>Email isn&apos;t configured — copy the link instead.</span>
      )}
      {state?.error && <span style={{ fontSize: 13, color: "var(--carnival-red)" }}>{state.error}</span>}
    </form>
  );
}
