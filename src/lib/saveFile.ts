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
