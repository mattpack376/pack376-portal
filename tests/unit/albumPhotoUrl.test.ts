/*
 * The public photo route (src/app/album-photos/[photoId]/[size]) fetches the
 * URL stored on the photo's row. isOwnedAlbumPhotoUrl is what keeps that to
 * our own Blob store's event photos, whatever the column holds.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isOwnedAlbumPhotoUrl } from "@/lib/blobCleanup";

const STORE = "https://jyclzu7uphezevn7.public.blob.vercel-storage.com";

describe("isOwnedAlbumPhotoUrl", () => {
  it("accepts an uploaded event photo and its thumbnail", () => {
    assert.ok(isOwnedAlbumPhotoUrl(`${STORE}/album-photos/0b6c1c2e-1111-4222-8333-944455556666.jpg`));
    assert.ok(isOwnedAlbumPhotoUrl(`${STORE}/album-photos/0b6c1c2e-1111-4222-8333-944455556666-thumb.jpg`));
  });

  it("refuses anything else", () => {
    for (const url of [
      `${STORE}/album-covers/cover.jpg`, // ours, but not an event photo
      `${STORE}/event-flyers/flyer.pdf`,
      `http://jyclzu7uphezevn7.public.blob.vercel-storage.com/album-photos/a.jpg`, // not https
      "https://other-store.public.blob.vercel-storage.com/album-photos/a.jpg",
      "https://jyclzu7uphezevn7.public.blob.vercel-storage.com.evil.example/album-photos/a.jpg",
      "https://169.254.169.254/album-photos/a.jpg",
      "http://localhost:3000/album-photos/a.jpg",
      "file:///etc/passwd",
      "/album-photos/a.jpg",
      "not a url",
      "",
    ]) {
      assert.equal(isOwnedAlbumPhotoUrl(url), false, url);
    }
  });
});
