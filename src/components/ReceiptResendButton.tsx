"use client";

import { useState, useTransition } from "react";
import { resendReceiptAction } from "@/lib/actions/receipts";

/** History row: emails a saved receipt again, defaulting to the address it last went to. */
export default function ReceiptResendButton({ id, lastEmailedTo }: { id: string; lastEmailedTo: string | null }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(lastEmailedTo ?? "");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const send = () =>
    startTransition(async () => {
      setMessage(null);
      const result = await resendReceiptAction(id, email);
      if (!result.ok) return setMessage({ kind: "error", text: result.error });
      setOpen(false);
      setMessage({ kind: "ok", text: `Sent to ${result.sentTo}.` });
    });

  if (!open) {
    return (
      <>
        <button
          type="button"
          className="btn btn-quiet btn-small"
          onClick={() => {
            setEmail(lastEmailedTo ?? "");
            setMessage(null);
            setOpen(true);
          }}
        >
          Resend
        </button>
        {message && (
          <span role="status" style={{ fontSize: 13, fontWeight: 600, color: message.kind === "ok" ? "var(--teal)" : "var(--carnival-red)" }}>
            {message.text}
          </span>
        )}
      </>
    );
  }

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
          maxLength={200}
          placeholder="Email address"
          aria-label="Email this receipt to"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <button type="submit" className="btn btn-primary btn-small" disabled={pending}>
        {pending ? "Sending…" : "Send"}
      </button>
      <button type="button" className="btn btn-quiet btn-small" disabled={pending} onClick={() => setOpen(false)}>
        Cancel
      </button>
      {message?.kind === "error" && (
        <span role="status" style={{ fontSize: 13, color: "var(--carnival-red)", flexBasis: "100%" }}>
          {message.text}
        </span>
      )}
    </form>
  );
}
