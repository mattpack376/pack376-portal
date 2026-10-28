"use client";

import { useState, useTransition } from "react";
import { deleteReceiptAction, type DeleteReceiptResult } from "@/lib/actions/receipts";

/**
 * Delete's error message ("" when it worked). A call that gets no answer at
 * all rejects; caught here, it's a message rather than the page's error
 * screen. The receipt may have been deleted anyway, so the message doesn't
 * call it a failure; a reload shows which (and pressing Delete again on a
 * receipt that's gone just says so).
 */
export async function deleteReceiptError(call: () => Promise<DeleteReceiptResult>): Promise<string> {
  try {
    const result = await call();
    return result.ok ? "" : result.error;
  } catch {
    return "Couldn't get an answer from the server, so we don't know whether it was deleted. Reload the page to check.";
  }
}

/** History row: deletes a receipt that was entered by mistake. Doesn't unsend an email. */
export default function ReceiptDeleteButton({
  id,
  label,
  emailedTo,
}: {
  id: string;
  /** "Test Donor, $90.00" — names the receipt in the confirm prompt. */
  label: string;
  emailedTo: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const handleClick = () => {
    const emailNote = emailedTo ? ` It was already emailed to ${emailedTo}, and deleting it won't unsend that email.` : "";
    if (!window.confirm(`Delete the receipt for ${label}? This removes it from the history and can't be undone.${emailNote}`)) return;
    setError("");
    startTransition(async () => {
      setError(await deleteReceiptError(() => deleteReceiptAction(id)));
    });
  };

  return (
    <>
      <button type="button" className="btn btn-danger btn-small" disabled={pending} onClick={handleClick}>
        {pending ? "Deleting…" : "Delete"}
      </button>
      {error && (
        <span role="alert" style={{ fontSize: 13, color: "var(--carnival-red)" }}>
          {error}
        </span>
      )}
    </>
  );
}
