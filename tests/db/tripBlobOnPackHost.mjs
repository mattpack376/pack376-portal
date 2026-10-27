/*
 * For tests/db/tripFlyerSave.test.ts only — import it first, before any app
 * module. Not a test file itself.
 *
 * The shared Blob stand-in (tests/support/mocks/blob.mjs) hands out URLs on a
 * test host, and deleteUploadedBlob (src/lib/blobCleanup.ts) only ever
 * deletes URLs on the pack's own Blob host. So with it, a test can't tell
 * whether a save that fails after its upload deletes the file it just
 * uploaded — the delete is skipped either way. This wraps the shared
 * stand-in, keeping everything it records, so uploads come back on the
 * pack's host (as they do in production) and cleanup's deletes show up in
 * testState.blobDeletes. Registered from this test process only, so no other
 * test file sees it.
 */
import { registerHooks } from "node:module";
import * as shared from "../support/mocks/blob.mjs";

const PACK_BLOB_ORIGIN = "https://jyclzu7uphezevn7.public.blob.vercel-storage.com";
const state = globalThis.__pack376Test;
let rejection = null;

/**
 * Makes the next upload fail with an error named UploadRejectedError — the
 * upload-validation module's "turned down, and here's why" error — carrying
 * `message`.
 */
export function rejectNextUpload(message) {
  rejection = message;
}

export async function put(pathname, body, options) {
  if (rejection !== null) {
    const error = new Error(rejection);
    error.name = "UploadRejectedError";
    rejection = null;
    throw error;
  }
  const result = await shared.put(pathname, body, options);
  const url = `${PACK_BLOB_ORIGIN}/${pathname.replace(/^\/+/, "")}`;
  state.blobPuts[state.blobPuts.length - 1].url = url;
  return { ...result, url };
}

export const del = shared.del;

const self = import.meta.url;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@vercel/blob" && context.parentURL !== self) {
      return { url: self, format: "module", shortCircuit: true };
    }
    return next(specifier, context);
  },
});
