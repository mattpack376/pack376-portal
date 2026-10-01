/**
 * Client-side: hands a PDF to the browser as a file download. A download link
 * on an in-page blob, rather than navigating to the PDF's URL — in the
 * installed (standalone) app a navigation takes over the window with no way to
 * share or go back, while this opens the phone's own viewer with its share/save
 * controls.
 */
export function savePdfBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Client-side: hands a base64 PDF to the browser as a file download. */
export function saveBase64Pdf(base64: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  savePdfBlob(new Blob([bytes], { type: "application/pdf" }), filename);
}
