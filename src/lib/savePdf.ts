import { saveBlob } from "@/lib/saveFile";

/** Client-side: a base64 PDF (what the receipt actions return) as a File. */
export function base64PdfFile(base64: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  return new File([bytes], filename, { type: "application/pdf" });
}

/** Client-side: hands a base64 PDF to the browser as a file download. */
export function saveBase64Pdf(base64: string, filename: string) {
  saveBlob(base64PdfFile(base64, filename), filename);
}
