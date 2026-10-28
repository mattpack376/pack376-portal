"use client";

import { useState, useTransition } from "react";
import { resendReceiptAction, type EmailReceiptResult } from "@/lib/actions/receipts";
import { MAX_EMAIL_LENGTH } from "@/lib/formValues";
import { newReceiptRequestKey } from "@/lib/receipts";

type Message = { kind: "ok" | "error"; text: string };

/**
 * Send's result: whether it's done (the form closes) and what to say. A call
 * that gets no answer at all — a dropped connection, a timeout, an error page
 * instead of a result — rejects; caught here, it leaves the form open with
 * its request key, rather than the page's error screen taking both away, so
 * pressing Send again repeats the same request.
 */
export async function resendOutcome(call: () => Promise<EmailReceiptResult>): Promise<{ done: boolean; message: Message }> {
  let result: EmailReceiptResult;
  try {
    result = await call();
  } catch {
    return {
      done: false,
      message: {
        kind: "error",
        text: "Couldn't get an answer from the server, so we don't know whether it went out. Press Send again to retry: if it did go out, it won't be sent twice.",
      },
    };
  }
  if (!result.ok) return { done: false, message: { kind: "error", text: result.error } };
  return {
    done: true,
    message: { kind: "ok", text: result.alreadySent ? `Already sent to ${result.sentTo}; not sent again.` : `Sent to ${result.sentTo}.` },
  };
}

/**
 * History row: emails a saved receipt again, defaulting to the address it
 * last went to. As "Resend", each time the form opens it gets a new request
 * key, and pressing Send again while it's still open — after an error, or
 * after the server's answer was lost — repeats that request, so it doesn't
 * email the receipt twice; reopening it and sending is a deliberate new copy.
 * The key lives only in the open form: a reload starts over.
 *
 * As "Retry email" (`retryKey` given: the latest request didn't go out, or
 * wasn't confirmed either way), it repeats that request instead — the same
 * key, defaulting to the same address — so if the first try did reach the
 * family after all, Resend returns that result rather than sending a second
 * copy. Changing the address makes it a new request to the new address.
 */
export default function ReceiptResendButton({
  id,
  lastEmailedTo,
  retryKey,
}: {
  id: string;
  lastEmailedTo: string | null;
  retryKey?: string;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(lastEmailedTo ?? "");
  const [requestKey, setRequestKey] = useState("");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<Message | null>(null);

  const send = () =>
    startTransition(async () => {
      setMessage(null);
      const outcome = await resendOutcome(() => resendReceiptAction(id, email, requestKey));
      if (outcome.done) setOpen(false);
      setMessage(outcome.message);
    });

  if (!open) {
    return (
      <>
        <button
          type="button"
          className="btn btn-quiet btn-small"
          onClick={() => {
            setEmail(lastEmailedTo ?? "");
            setRequestKey(retryKey ?? newReceiptRequestKey());
            setMessage(null);
            setOpen(true);
          }}
        >
          {retryKey ? "Retry email" : "Resend"}
        </button>
        {message && (
          <span
            role={message.kind === "ok" ? "status" : "alert"}
            style={{ fontSize: 13, fontWeight: 600, color: message.kind === "ok" ? "var(--teal)" : "var(--carnival-red)" }}
          >
            {message.text}
          </span>
        )}
      </>
    );
  }

  const errorId = `receipt-resend-error-${id}`;
  return (
    <form
      style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", width: "100%" }}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <div className="form-field" style={{ margin: 0, flex: "1 1 200px", minWidth: 0 }}>
        <input
          type="email"
          inputMode="email"
          autoComplete="off"
          maxLength={MAX_EMAIL_LENGTH}
          placeholder="Email address"
          aria-label="Email this receipt to"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          {...(message?.kind === "error" ? { "aria-invalid": true, "aria-describedby": errorId } : {})}
        />
      </div>
      <button type="submit" className="btn btn-primary btn-small" disabled={pending}>
        {pending ? "Sending…" : "Send"}
      </button>
      <button type="button" className="btn btn-quiet btn-small" disabled={pending} onClick={() => setOpen(false)}>
        Cancel
      </button>
      {message?.kind === "error" && (
        <span id={errorId} role="alert" style={{ fontSize: 13, color: "var(--carnival-red)", flexBasis: "100%" }}>
          {message.text}
        </span>
      )}
    </form>
  );
}
