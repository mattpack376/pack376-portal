// Records uploads/deletes instead of touching Vercel Blob.
const state = globalThis.__pack376Test;
let counter = 0;
// testState.blobHost picks the host in returned URLs. The default is not the
// pack's store, so the app's owned-URL check ignores these objects; set it to
// the real store host to exercise cleanup of new uploads.
export async function put(pathname, body, options) {
  if (state.failBlobPut) throw new Error("Simulated Blob upload failure");
  counter += 1;
  const clean = pathname.replace(/^\/+/, "");
  const url =
    state.blobHost === "test.public.blob.vercel-storage.com"
      ? `https://${state.blobHost}/${clean}-${counter}`
      : `https://${state.blobHost}/${clean}`;
  state.blobPuts.push({ pathname, url, options, size: body?.size ?? body?.byteLength ?? null });
  return { url, pathname, contentType: options?.contentType ?? null };
}
export async function del(urlOrUrls) {
  if (state.failBlobDel) throw new Error("Simulated Blob delete failure");
  for (const url of [urlOrUrls].flat()) state.blobDeletes.push(url);
}
