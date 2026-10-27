// Stands in for src/lib/blobCleanup.ts in eventFlyerCleanup.test.ts and
// records every URL the app asks it to delete. The real helper only deletes
// URLs on the pack's own Blob host, and the fake @vercel/blob hands out test
// URLs, so it would quietly skip them all; what the events code is
// responsible for is asking, with the right URL, at the right time.
globalThis.__eventFlyerCleanupCalls ??= [];

export async function deleteUploadedBlob(url) {
  if (url) globalThis.__eventFlyerCleanupCalls.push(url);
}

// The rest of blobCleanup.ts's exports, so modules that import them
// (flyerUpload.ts retries queued deletions after each upload) still load.
export async function discardUnsavedUpload(url) {
  if (url) globalThis.__eventFlyerCleanupCalls.push(url);
}

export async function processPendingBlobDeletions() {}
