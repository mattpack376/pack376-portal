"use client";

import { useState, useTransition } from "react";
import { resendReceiptAction } from "@/lib/actions/receipts";
import { MAX_EMAIL_LENGTH } from "@/lib/formValues";
import { newReceiptRequestKey } from "@/lib/receipts";

/**
 * History row: emails a saved receipt again, defaulting to the address it
 * last went to (or, after a failed try, the one it was meant for). Each time
 * the form opens it gets a new request key, so pressing Send again after a
 * dropped connection doesn't email the receipt twice — but reopening it and
 * sending is a deliberate new copy.
 */
export default function ReceiptResendButton({
  id,
  lastEmailedTo,
  label = "Resend",
}: {
  id: string;
  lastEmailedTo: string | null;
  /** "Resend", or "Retry email" on a row whose last try didn't go out. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(lastEmailedTo ?? "");
  const [requestKey, setRequestKey] = useState("");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const send = () =>
    startTransition(async () => {
      setMessage(null);
      const result = await resendReceiptAction(id, email, requestKey);
      if (!result.ok) return setMessage({ kind: "error", text: result.error });
      setOpen(false);
      setMessage({
        kind: "ok",
        text: result.alreadySent ? `Already sent to ${result.sentTo}; not sent again.` : `Sent to ${result.sentTo}.`,
      });
    });

  if (!open) {
    return (
      <>
        <button
          type="button"
          className="btn btn-quiet btn-small"
          onClick={() => {
            setEmail(lastEmailedTo ?? "");
            setRequestKey(newReceiptRequestKey());
            setMessage(null);
            setOpen(true);
          }}
        >
          {label}
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
