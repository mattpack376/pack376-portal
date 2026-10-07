"use client";

import { useState, useTransition } from "react";
import { downloadSavedReceiptAction } from "@/lib/actions/receipts";
import { base64PdfFile } from "@/lib/savePdf";
import PdfDownloadButton from "@/components/PdfDownloadButton";

/**
 * One row of the receipt history: rebuilds that receipt's PDF from what was
 * saved — downloaded on a computer, handed to the share sheet on a phone.
 */
export default function ReceiptDownloadButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const buildPdf = () =>
    new Promise<File | null>((resolve) =>
      startTransition(async () => {
        setError("");
        const result = await downloadSavedReceiptAction(id);
        if (!result.ok) {
          setError(result.error);
          return resolve(null);
        }
        resolve(base64PdfFile(result.pdfBase64, result.filename));
      })
    );

  return (
    <>
      <PdfDownloadButton className="btn btn-quiet btn-small" disabled={pending} getFile={buildPdf} />
      {error && <span style={{ fontSize: 13, color: "var(--carnival-red)" }}>{error}</span>}
    </>
  );
}
