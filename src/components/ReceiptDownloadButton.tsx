"use client";

import { useState, useTransition } from "react";
import { downloadSavedReceiptAction } from "@/lib/actions/receipts";
import { saveBase64Pdf } from "@/lib/savePdf";

/** One row of the receipt history: rebuilds that receipt's PDF from what was saved. */
export default function ReceiptDownloadButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  return (
    <>
      <button
        type="button"
        className="btn btn-quiet btn-small"
        disabled={pending}
        onClick={() => {
          setError("");
          startTransition(async () => {
            const result = await downloadSavedReceiptAction(id);
            if (result.ok) saveBase64Pdf(result.pdfBase64, result.filename);
            else setError(result.error);
          });
        }}
      >
        {pending ? "Preparing…" : "Download PDF"}
      </button>
      {error && <span style={{ fontSize: 13, color: "var(--carnival-red)" }}>{error}</span>}
    </>
  );
}
