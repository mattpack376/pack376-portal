"use client";

import { useActionState, useRef } from "react";
import {
  emailAllUnansweredConsentLinksAction,
  type EmailAllConsentLinksState,
} from "@/lib/actions/photoConsent";
import { keyForPress, orUnreachable, type Press } from "@/lib/requestKey";

const initialState: EmailAllConsentLinksState = {};

// A press that gets no answer at all comes back as { unreachable: true }
// rather than the page's error screen (see orUnreachable).
const emailAll = orUnreachable(emailAllUnansweredConsentLinksAction);

const families = (n: number) => `${n} ${n === 1 ? "family" : "families"}`;

/**
 * Whether the next press should repeat the last one under its key: the last
 * press got no answer, or Resend didn't confirm some of it and would still
 * recognize a repeat (it can't once the list has changed).
 */
export function emailAllOutcomeUnknown(state: EmailAllConsentLinksState) {
  return !!state.unreachable || (!!state.unconfirmed && state.repeatable === true);
}

export type EmailAllNote = { tone: "ok" | "note" | "alert"; text: string };

/** What the button says after a press (nothing before one). */
export function emailAllMessage(state: EmailAllConsentLinksState): EmailAllNote | null {
  if (state.error) return { tone: "alert", text: state.error };
  if (state.unreachable) {
    return {
      tone: "alert",
      text: "Couldn't get an answer from the server, so we don't know whether the emails went out. Press Email All again to retry: any family they did reach won't get a second copy.",
    };
  }
  if (state.sent === undefined) return null;
  if (state.configured === false) return { tone: "note", text: "Email isn't configured — copy the links individually instead." };

  const failed = state.failed ?? 0;
  const unconfirmed = state.unconfirmed ?? 0;
  if (state.sent === 0 && !failed && !unconfirmed) return { tone: "ok", text: "Nobody left to email." };
  const parts: string[] = [];
  if (state.sent) parts.push(`Sent to ${families(state.sent)}.`);
  if (failed) parts.push(`${failed} didn't go through — use each scout's Copy Link instead.`);
  if (unconfirmed) {
    // Not "didn't go through": Resend may well have sent these.
    parts.push(
      `Resend didn't confirm whether the email${unconfirmed === 1 ? "" : "s"} to ${families(unconfirmed)} went out, so ${unconfirmed === 1 ? "it" : "they"} may have.`,
      state.repeatable
        ? "Press Email All again to retry: any family the last try did reach won't get a second copy."
        : "The list has changed since that try, so pressing Email All again would email every family on it again. Use each scout's Copy Link for anyone who says they didn't get it."
    );
  }
  return { tone: failed || unconfirmed ? "alert" : "ok", text: parts.join(" ") };
}

const NOTE_STYLE = {
  ok: { fontSize: 14, fontWeight: 600, color: "var(--teal)" },
  note: { fontSize: 14, color: "var(--ink-soft)" },
  alert: { fontSize: 14, fontWeight: 600, color: "var(--carnival-red)" },
} as const;

/**
 * Not Answered tab: emails every unanswered family their own consent link in
 * one go. `count`/`noEmailCount` are the page's own tally, for the label and
 * the confirm prompt only — the action recomputes who to send to.
 *
 * Each press sends a request key, made when the confirm prompt opens (see
 * requestKey.ts). After a press whose outcome isn't fully known, the next
 * press repeats it under the same key, so Resend hands back what it already
 * sent instead of emailing those families a second time. The key lives as
 * long as the page does: a reload starts over.
 */
export default function EmailAllConsentLinksButton({ count, noEmailCount }: { count: number; noEmailCount: number }) {
  const [state, formAction, pending] = useActionState(emailAll, initialState);
  const keyInput = useRef<HTMLInputElement>(null);
  const lastPress = useRef<Press | null>(null);
  const message = emailAllMessage(state);

  return (
    <div style={{ marginBottom: 20 }}>
      {count > 0 && (
        <form
          action={formAction}
          onSubmit={(e) => {
            const press = keyForPress(lastPress.current, emailAllOutcomeUnknown(state));
            const question =
              press === lastPress.current
                ? "Try Email All again? Any family the last try already reached won't get a second copy."
                : `Email ${families(count)} their scout's photo consent link? Each family gets their own link. Scouts without a link yet will get one generated.`;
            if (!window.confirm(question)) return e.preventDefault();
            lastPress.current = press;
            // Set on the field itself: React reads the form's data right after this handler.
            if (keyInput.current) keyInput.current.value = press.key;
          }}
          style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
        >
          <input ref={keyInput} type="hidden" name="requestKey" defaultValue="" />
          <button type="submit" disabled={pending} className="btn btn-primary btn-small">
            {pending ? "Sending…" : `Email All (${count})`}
          </button>
          {message && (
            <span role={message.tone === "alert" ? "alert" : "status"} style={NOTE_STYLE[message.tone]}>
              {message.text}
            </span>
          )}
        </form>
      )}
      {noEmailCount > 0 && (
        <p className="form-note" style={{ marginTop: 8, marginBottom: 0 }}>
          {noEmailCount} {noEmailCount === 1 ? "scout has" : "scouts have"} no usable parent email on file and won&apos;t
          be emailed — share their links below by hand instead.
        </p>
      )}
    </div>
  );
}
