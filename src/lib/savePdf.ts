/** Client-side: a base64 PDF (what the receipt actions return) as a File. */
export function base64PdfFile(base64: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  return new File([bytes], filename, { type: "application/pdf" });
}
