"use client";

import { useState, useTransition } from "react";
import { downloadSavedReceiptAction, type GenerateReceiptResult } from "@/lib/actions/receipts";
import { base64PdfFile } from "@/lib/savePdf";
import PdfDownloadButton from "@/components/PdfDownloadButton";
import { SIGNED_OUT_HINT } from "@/lib/requestKey";

/**
 * The saved PDF, or why there isn't one. A call that gets no answer at all
 * (a dropped connection, a timeout) rejects; caught here, it's a message
 * rather than the page's error screen, and the button goes back to Download
 * PDF instead of sticking on "Preparing…". Nothing is saved or sent by this
 * one, so pressing it again is always safe.
 */
export async function savedReceiptPdf(call: () => Promise<GenerateReceiptResult>): Promise<{ file: File | null; error: string }> {
  let result: GenerateReceiptResult;
  try {
    result = await call();
  } catch {
    return { file: null, error: `Couldn't get an answer from the server. Check your connection and press Download PDF again. ${SIGNED_OUT_HINT}` };
  }
  if (!result.ok) return { file: null, error: result.error };
  return { file: base64PdfFile(result.pdfBase64, result.filename), error: "" };
}

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
        const { file, error: problem } = await savedReceiptPdf(() => downloadSavedReceiptAction(id));
        setError(problem);
        resolve(file);
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
