"use client";

import { useActionState, useRef } from "react";
import { sendPhotoConsentLinkEmailAction, type SendConsentEmailState } from "@/lib/actions/photoConsent";
import { keyForPress, orUnreachable, type Press } from "@/lib/requestKey";

const initialState: SendConsentEmailState = {};

// A press that gets no answer at all comes back as { unreachable: true }
// rather than the page's error screen (see orUnreachable).
const sendLink = orUnreachable(sendPhotoConsentLinkEmailAction);

/** Whether the last press's outcome is unknown, so the next press should repeat it under the same key. */
export function consentLinkOutcomeUnknown(state: SendConsentEmailState) {
  return !!(state.uncertain || state.unreachable);
}

export type ConsentLinkNote = { tone: "ok" | "note" | "alert"; text: string };

/** What the button says after a press (nothing before one). */
export function consentLinkMessage(state: SendConsentEmailState): ConsentLinkNote | null {
  if (state.error) return { tone: "alert", text: state.error };
  if (state.unreachable) {
    return {
      tone: "alert",
      text: "Couldn't get an answer from the server, so we don't know whether it went out. Press the button again to retry: if it did go out, it won't be sent twice.",
    };
  }
  if (state.sent) return { tone: "ok", text: "Sent!" };
  if (state.sent !== false) return null;
  if (state.configured === false) return { tone: "note", text: "Email isn't configured — copy the link instead." };
  if (state.uncertain) {
    return {
      tone: "alert",
      text: "Resend didn't confirm whether it went out, so it may have. Press the button again to retry: if it did go out, it won't be sent twice.",
    };
  }
  const because = state.reason?.trim().replace(/[.!\s]+$/, "");
  return { tone: "alert", text: `It didn't go out${because ? ` (${because})` : ""} — copy the link instead.` };
}

const NOTE_STYLE = {
  ok: { fontSize: 13, color: "var(--teal)", fontWeight: 600 },
  note: { fontSize: 13, color: "var(--ink-soft)" },
  alert: { fontSize: 13, color: "var(--carnival-red)" },
} as const;

/**
 * Emails a scout's consent link to the parent address shown on the button.
 * The action only ever sends to a matching parent email it finds on file for
 * this scout, so the hidden field just says which one.
 *
 * Each press sends a request key (see requestKey.ts). A press after one whose
 * outcome isn't known (Resend didn't confirm it, or no answer came back) sends
 * that press's key again, so if the first did reach the family Resend returns
 * that result instead of emailing them a second copy; any other press is a
 * new request. The key lives as long as the page does: a reload starts over.
 */
export default function EmailConsentLinkButton({ scoutId, parentEmail }: { scoutId: string; parentEmail: string }) {
  const [state, formAction, pending] = useActionState(sendLink, initialState);
  const keyInput = useRef<HTMLInputElement>(null);
  const lastPress = useRef<Press | null>(null);
  const message = consentLinkMessage(state);

  return (
    <form
      action={formAction}
      onSubmit={() => {
        const press = keyForPress(lastPress.current, consentLinkOutcomeUnknown(state));
        lastPress.current = press;
        // Set on the field itself: React reads the form's data right after this handler.
        if (keyInput.current) keyInput.current.value = press.key;
      }}
      style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
    >
      <input type="hidden" name="scoutId" value={scoutId} />
      <input type="hidden" name="parentEmail" value={parentEmail} />
      <input ref={keyInput} type="hidden" name="requestKey" defaultValue="" />
      <button type="submit" disabled={pending} className="btn btn-quiet btn-small" style={{ borderColor: "var(--teal)", color: "var(--teal)" }}>
        {pending ? "Sending…" : `Email Link to ${parentEmail}`}
      </button>
      {message && (
        <span role={message.tone === "alert" ? "alert" : "status"} style={NOTE_STYLE[message.tone]}>
          {message.text}
        </span>
      )}
    </form>
  );
}
