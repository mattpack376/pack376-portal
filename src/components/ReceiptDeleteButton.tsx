"use client";

import { useState, useTransition } from "react";
import { deleteReceiptAction } from "@/lib/actions/receipts";

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
      const result = await deleteReceiptAction(id);
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <>
      <button type="button" className="btn btn-danger btn-small" disabled={pending} onClick={handleClick}>
        {pending ? "Deleting…" : "Delete"}
      </button>
      {error && <span style={{ fontSize: 13, color: "var(--carnival-red)" }}>{error}</span>}
    </>
  );
}
