/**
 * Client-side: hands a file to the browser as a download. A download link on an
 * in-page blob, rather than navigating to the file's URL — in the installed
 * (standalone) app a navigation takes over the window with no way to share or
 * go back, while this opens the phone's own viewer or save sheet.
 */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A touch device (phone, tablet) whose browser can hand a file of this type to the share sheet. */
export function sharesOnTap(type: string) {
  if (typeof navigator.canShare !== "function") return false;
  if (!window.matchMedia("(pointer: coarse)").matches) return false;
  try {
    return navigator.canShare({ files: [new File([""], "file", { type })] });
  } catch {
    return false;
  }
}

/**
 * Client-side, phones: opens the share sheet with the file and nothing else —
 * Messages, Mail, Save to Files, Print. Saved with saveBlob instead, a PDF
 * opens in the phone's own viewer, and sharing from there also sends a "blob:"
 * line and a link card for the page that opened it; the site can't change
 * what that viewer sends. navigator.share with only `files` (no title, text or
 * url) shares just the file.
 *
 * "needs-tap": the phone wants a fresh tap — building the file outlasted this
 * one — so share again from the next tap. "done": shared, or the sheet was
 * closed. If the sheet can't take the file at all, this falls back to
 * saveBlob and reports "done".
 */
export async function shareFileOnly(file: File): Promise<"done" | "needs-tap"> {
  try {
    await navigator.share({ files: [file] });
  } catch (err) {
    if (!(err instanceof DOMException)) throw err;
    if (err.name === "NotAllowedError") return "needs-tap";
    if (err.name !== "AbortError") saveBlob(file, file.name);
  }
  return "done";
}
