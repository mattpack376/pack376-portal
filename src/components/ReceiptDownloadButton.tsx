"use client";

import { useState, useTransition } from "react";
import { downloadSavedReceiptAction } from "@/lib/actions/receipts";
import { base64PdfFile } from "@/lib/savePdf";
import PdfDownloadButton from "@/components/PdfDownloadButton";

/**
 * One row of the receipt history: that receipt's PDF exactly as it was
 * issued — downloaded on a computer, handed to the share sheet on a phone.
 * A receipt saved before issued PDFs were kept (`archived` false) can only
 * be rebuilt from its saved details with today's layout, and says so.
 */
export default function ReceiptDownloadButton({ id, archived }: { id: string; archived: boolean }) {
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
      {/* Visible text, not a tooltip, so touch, keyboard and screen-reader users get the reason too. */}
      {!archived && (
        <span className="form-note" style={{ margin: 0, fontSize: 12 }}>
          Rebuilt copy (today&apos;s layout): saved before issued PDFs were kept
        </span>
      )}
      {error && (
        <span role="alert" style={{ fontSize: 13, color: "var(--carnival-red)" }}>
          {error}
        </span>
      )}
    </>
  );
}
