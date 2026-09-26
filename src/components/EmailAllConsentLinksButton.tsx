"use client";

import { useActionState } from "react";
import {
  emailAllUnansweredConsentLinksAction,
  type EmailAllConsentLinksState,
} from "@/lib/actions/photoConsent";

const initialState: EmailAllConsentLinksState = {};

/**
 * Not Answered tab: emails every unanswered family their own consent link in
 * one go. `count`/`noEmailCount` are the page's own tally, for the label and
 * the confirm prompt only — the action recomputes who to send to.
 */
export default function EmailAllConsentLinksButton({ count, noEmailCount }: { count: number; noEmailCount: number }) {
  const [state, formAction, pending] = useActionState(emailAllUnansweredConsentLinksAction, initialState);
  const families = (n: number) => `${n} ${n === 1 ? "family" : "families"}`;

  return (
    <div style={{ marginBottom: 20 }}>
      {count > 0 && (
        <form
          action={formAction}
          onSubmit={(e) => {
            if (
              !window.confirm(
                `Email ${families(count)} their scout's photo consent link? Each family gets their own link. Scouts without a link yet will get one generated.`
              )
            )
              e.preventDefault();
          }}
          style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
        >
          <button type="submit" disabled={pending} className="btn btn-primary btn-small">
            {pending ? "Sending…" : `Email All (${count})`}
          </button>
          {state.sent !== undefined && state.configured === false && (
            <span style={{ fontSize: 14, color: "var(--ink-soft)" }}>
              Email isn&apos;t configured — copy the links individually instead.
            </span>
          )}
          {state.sent !== undefined && state.configured !== false && (
            <span style={{ fontSize: 14, fontWeight: 600, color: state.failed ? "var(--carnival-red)" : "var(--teal)" }}>
              {state.sent === 0 && !state.failed
                ? "Nobody left to email."
                : `Sent to ${families(state.sent)}.`}
              {state.failed ? ` ${state.failed} didn't go through — use each scout's Copy Link instead.` : ""}
            </span>
          )}
          {state.error && <span style={{ fontSize: 14, color: "var(--carnival-red)" }}>{state.error}</span>}
        </form>
      )}
      {noEmailCount > 0 && (
        <p className="form-note" style={{ marginTop: 8, marginBottom: 0 }}>
          {noEmailCount} {noEmailCount === 1 ? "scout has" : "scouts have"} no parent email on file and won&apos;t be
          emailed — share their links below by hand instead.
        </p>
      )}
    </div>
  );
}
