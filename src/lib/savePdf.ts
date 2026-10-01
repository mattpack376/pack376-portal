import { saveBlob } from "@/lib/saveFile";

/** Client-side: hands a base64 PDF to the browser as a file download. */
export function saveBase64Pdf(base64: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  saveBlob(new Blob([bytes], { type: "application/pdf" }), filename);
}
