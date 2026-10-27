// Records uploads/deletes instead of touching Vercel Blob.
const state = globalThis.__pack376Test;
let counter = 0;
export async function put(pathname, body, options) {
  if (state.failBlobPut) throw new Error("Simulated Blob upload failure");
  counter += 1;
  const url = `https://test.public.blob.vercel-storage.com/${pathname.replace(/^\/+/, "")}-${counter}`;
  state.blobPuts.push({ pathname, url, options, size: body?.size ?? body?.byteLength ?? null });
  return { url, pathname, contentType: options?.contentType ?? null };
}
export async function del(urlOrUrls) {
  for (const url of [urlOrUrls].flat()) state.blobDeletes.push(url);
}
