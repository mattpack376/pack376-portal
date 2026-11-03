/*
 * Event photos (AlbumPhoto) against a real database: who can add, move and
 * remove them; that what's stored is two cleaned, watermarked JPEGs; the
 * per-album limit, also when uploads race; and that removing a photo, or
 * deleting its album, deletes its files from storage.
 *
 * The fake @vercel/blob (tests/support/mocks/blob.mjs) hands out URLs on
 * test.public.blob.vercel-storage.com; TEST_BLOB_HOSTNAME lets blobCleanup.ts
 * treat that stand-in store as ours (only under NODE_ENV=test).
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import sharp from "sharp";
import { withTestDatabase } from "../support/db";
import { form, resetTestState, runAs, settle, testState, type SessionUser } from "../support/context";

process.env.TEST_BLOB_HOSTNAME = "test.public.blob.vercel-storage.com";

const db = withTestDatabase("album_photos");

let photos: typeof import("@/lib/actions/albumPhotos");
let albums: typeof import("@/lib/actions/albums");
let rules: typeof import("@/lib/albumPhotoRules");

let admin: SessionUser;
let photographer: SessionUser;
let juniorAdmin: SessionUser;
let parent: SessionUser;

before(async () => {
  await db.ready;
  photos = await import("@/lib/actions/albumPhotos");
  albums = await import("@/lib/actions/albums");
  rules = await import("@/lib/albumPhotoRules");

  const make = async (username: string, role: SessionUser["role"]) => {
    const user = await db.prisma.user.create({ data: { username, passwordHash: "x", role, displayName: username } });
    return { id: user.id, role, sessionVersion: 0 };
  };
  admin = await make("photos-admin", "ADMIN");
  photographer = await make("photos-photographer", "PHOTOGRAPHER");
  juniorAdmin = await make("photos-junior", "JUNIOR_ADMIN");
  parent = await make("photos-parent", "PARENT");
});

beforeEach(async () => {
  resetTestState();
  await db.prisma.pendingBlobDeletion.deleteMany();
});

async function photoFile(width = 1200, height = 900, name = "IMG_0001.jpg") {
  const jpeg = await sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 60 } } })
    .jpeg()
    .withExif({ IFD0: { Make: "TestPhone" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 39/1 0/1" } })
    .toBuffer();
  return new File([jpeg], name, { type: "image/jpeg" });
}

async function makeAlbum(title = "Fall Campout") {
  return db.prisma.photoAlbum.create({ data: { title, eventDate: new Date("2026-10-10T00:00:00Z") } });
}

async function upload(user: SessionUser, albumId: string, file?: File) {
  const data = form({ albumId });
  data.set("photo", file ?? (await photoFile()));
  return runAs(user, () => photos.uploadAlbumPhotoAction(data));
}

/** Seeds photo rows straight into the database, with owned-looking URLs. */
async function seedPhotos(albumId: string, count: number) {
  for (let i = 0; i < count; i++) {
    await db.prisma.albumPhoto.create({
      data: {
        albumId,
        imageUrl: `https://test.public.blob.vercel-storage.com/album-photos/seed-${albumId}-${i}.jpg`,
        thumbUrl: `https://test.public.blob.vercel-storage.com/album-photos/seed-${albumId}-${i}-thumb.jpg`,
        width: 1600,
        height: 1200,
        sortOrder: i,
      },
    });
  }
}

describe("uploadAlbumPhotoAction", () => {
  it("stores a full and a grid copy: JPEGs, resized, metadata removed, and logs it", async () => {
    const album = await makeAlbum("Upload test");
    const result = await upload(photographer, album.id, await photoFile(4000, 3000));
    assert.deepEqual(result, { ok: true });

    assert.equal(testState.blobPuts.length, 2);
    const [full, thumb] = testState.blobPuts;
    assert.match(full.pathname, /^album-photos\/[0-9a-f-]{36}\.jpg$/);
    assert.match(thumb.pathname, /^album-photos\/[0-9a-f-]{36}-thumb\.jpg$/);
    assert.equal(full.options?.contentType, "image/jpeg");

    const row = await db.prisma.albumPhoto.findFirstOrThrow({ where: { albumId: album.id } });
    assert.equal(row.imageUrl, full.url);
    assert.equal(row.thumbUrl, thumb.url);
    assert.equal(row.width, rules.ALBUM_PHOTO_FULL_SIDE);
    assert.equal(row.height, 1200);
    assert.equal(row.sortOrder, 0);

    const entry = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "album.addPhoto", entityId: album.id } });
    assert.equal(entry.category, "album");
  });

  it("really strips EXIF and stamps the watermark (bottom-right corner differs from the plain photo)", async () => {
    const { processAlbumPhotoBytes } = await import("@/lib/albumPhotoImage");
    const plain = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#0a783c" } })
      .jpeg()
      .withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 39/1 0/1" } })
      .toBuffer();
    const out = await processAlbumPhotoBytes(new Uint8Array(plain), "image/jpeg", sharp);
    const meta = await sharp(out.full).metadata();
    assert.equal(meta.format, "jpeg");
    assert.equal(meta.exif, undefined);
    assert.equal((await sharp(out.thumb).metadata()).width, rules.ALBUM_PHOTO_THUMB_SIDE);

    // The mark sits bottom-right: that corner is no longer the plain green, the top-left still is.
    // stats() reads the whole input, so each region is cut out into its own image first.
    const region = async (left: number, top: number) =>
      sharp(await sharp(out.full).extract({ left, top, width: 120, height: 40 }).toBuffer()).stats();
    const corner = await region(1400, 1100);
    const clear = await region(20, 20);
    const spread = (s: Awaited<ReturnType<typeof region>>) => s.channels[0].max - s.channels[0].min;
    assert.ok(spread(corner) > 100, "watermark lettering should be in the bottom-right corner");
    assert.ok(spread(clear) < 20, "the rest of the photo should be untouched");
  });

  it("a Junior Admin can upload too", async () => {
    const album = await makeAlbum("Junior upload");
    assert.deepEqual(await upload(juniorAdmin, album.id), { ok: true });
    assert.equal(await db.prisma.albumPhoto.count({ where: { albumId: album.id } }), 1);
  });

  it("a Junior Admin still can't delete a whole album", async () => {
    const album = await makeAlbum("Junior can't delete");
    const refused = await settle(runAs(juniorAdmin, () => albums.deleteAlbumAction(form({ albumId: album.id }))));
    assert.equal(refused.ok, false);
    assert.equal(await db.prisma.photoAlbum.count({ where: { id: album.id } }), 1);
  });

  it("is refused for anyone who can't edit albums, and nothing is uploaded", async () => {
    const album = await makeAlbum();
    assert.deepEqual(await upload(parent, album.id), { ok: false, error: "Not authorized." });
    assert.equal(testState.blobPuts.length, 0);
    assert.equal(await db.prisma.albumPhoto.count({ where: { albumId: album.id } }), 0);
  });

  it("turns away files that aren't photos, GIFs, and tiny pictures, uploading nothing", async () => {
    const album = await makeAlbum();
    const svg = new File(["<svg xmlns='http://www.w3.org/2000/svg'></svg>"], "x.jpg", { type: "image/jpeg" });
    const gif = new File(
      [await sharp({ create: { width: 400, height: 400, channels: 3, background: "#fff" } }).gif().toBuffer()],
      "x.gif",
      { type: "image/gif" },
    );
    for (const file of [svg, gif, await photoFile(200, 150)]) {
      const result = await upload(admin, album.id, file);
      assert.equal(result.ok, false);
    }
    const tiny = await upload(admin, album.id, await photoFile(200, 150));
    assert.match((tiny as { error: string }).error, /too small/);
    assert.equal(testState.blobPuts.length, 0);
  });

  it("stops at the album limit, before uploading anything", async () => {
    const album = await makeAlbum();
    await seedPhotos(album.id, rules.MAX_PHOTOS_PER_ALBUM);
    const result = await upload(admin, album.id);
    assert.equal(result.ok, false);
    assert.match((result as { error: string }).error, /already has 10 photos/);
    assert.equal(testState.blobPuts.length, 0);
  });

  it("keeps to the limit when uploads race for the last place, and removes the loser's files", async () => {
    const album = await makeAlbum();
    await seedPhotos(album.id, rules.MAX_PHOTOS_PER_ALBUM - 1);
    const results = await Promise.all([upload(admin, album.id), upload(photographer, album.id)]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(await db.prisma.albumPhoto.count({ where: { albumId: album.id } }), rules.MAX_PHOTOS_PER_ALBUM);
    // Four files went up; the two that lost were deleted again.
    assert.equal(testState.blobPuts.length, 4);
    const kept = await db.prisma.albumPhoto.findMany({ where: { albumId: album.id } });
    const keptUrls = new Set(kept.flatMap((p) => [p.imageUrl, p.thumbUrl]));
    const lost = testState.blobPuts.map((p) => p.url).filter((url) => !keptUrls.has(url));
    assert.equal(lost.length, 2);
    assert.deepEqual([...testState.blobDeletes].sort(), lost.sort());
  });

  it("removes the first file when the second upload fails", async () => {
    const album = await makeAlbum();
    // Fail only the second put.
    let calls = 0;
    const original = testState.blobPuts.push.bind(testState.blobPuts);
    testState.blobPuts.push = (...items) => {
      calls += 1;
      if (calls === 1) testState.failBlobPut = true;
      return original(...items);
    };
    const result = await upload(admin, album.id);
    testState.blobPuts.push = original;
    assert.equal(result.ok, false);
    assert.equal(testState.blobPuts.length, 1);
    assert.deepEqual(testState.blobDeletes, [testState.blobPuts[0].url]);
    assert.equal(await db.prisma.albumPhoto.count({ where: { albumId: album.id } }), 0);
  });

  it("refuses an album that no longer exists", async () => {
    const result = await upload(admin, "no-such-album");
    assert.equal(result.ok, false);
    assert.equal(testState.blobPuts.length, 0);
  });
});

describe("moving and removing photos", () => {
  it("moves a photo one place and renumbers the album", async () => {
    const album = await makeAlbum();
    await seedPhotos(album.id, 3);
    const ordered = async () =>
      (await db.prisma.albumPhoto.findMany({ where: { albumId: album.id }, orderBy: { sortOrder: "asc" } })).map(
        (p) => p.imageUrl.match(/-(\d)\.jpg$/)![1],
      );
    const first = await db.prisma.albumPhoto.findFirstOrThrow({ where: { albumId: album.id, sortOrder: 0 } });
    await runAs(photographer, () => photos.moveAlbumPhotoAction(form({ photoId: first.id, direction: "down" })));
    assert.deepEqual(await ordered(), ["1", "0", "2"]);
    // Already first: nothing changes.
    const nowFirst = await db.prisma.albumPhoto.findFirstOrThrow({ where: { albumId: album.id, sortOrder: 0 } });
    await runAs(admin, () => photos.moveAlbumPhotoAction(form({ photoId: nowFirst.id, direction: "up" })));
    assert.deepEqual(await ordered(), ["1", "0", "2"]);

    const refused = await settle(runAs(parent, () => photos.moveAlbumPhotoAction(form({ photoId: first.id, direction: "up" }))));
    assert.equal(refused.ok, false);
  });

  it("a Photographer can remove a photo; both its files are deleted from storage", async () => {
    const album = await makeAlbum();
    await seedPhotos(album.id, 2);
    const photo = await db.prisma.albumPhoto.findFirstOrThrow({ where: { albumId: album.id, sortOrder: 1 } });
    await runAs(photographer, () => photos.deleteAlbumPhotoAction(form({ photoId: photo.id })));
    assert.equal(await db.prisma.albumPhoto.count({ where: { id: photo.id } }), 0);
    assert.deepEqual([...testState.blobDeletes].sort(), [photo.imageUrl, photo.thumbUrl].sort());
    assert.ok(await db.prisma.auditLog.findFirst({ where: { action: "album.deletePhoto", entityId: album.id } }));

    const refused = await settle(runAs(parent, () => photos.deleteAlbumPhotoAction(form({ photoId: "x" }))));
    assert.equal(refused.ok, false);
  });

  it("deleting an album deletes every one of its photos' files too", async () => {
    const album = await makeAlbum("Doomed album");
    await seedPhotos(album.id, 3);
    const rows = await db.prisma.albumPhoto.findMany({ where: { albumId: album.id } });
    await runAs(admin, () => albums.deleteAlbumAction(form({ albumId: album.id })));
    assert.equal(await db.prisma.albumPhoto.count({ where: { albumId: album.id } }), 0);
    assert.deepEqual(
      [...testState.blobDeletes].sort(),
      rows.flatMap((p) => [p.imageUrl, p.thumbUrl]).sort(),
    );
  });
});

describe("albums without an outside link", () => {
  it("can be created with no album link, and a bad link is still refused", async () => {
    const created = await settle(
      runAs(admin, () => albums.createAlbumAction({}, form({ title: "No link album", eventDate: "2026-11-14" }))),
    );
    assert.equal(created.ok, false); // finished with a redirect
    const album = await db.prisma.photoAlbum.findFirstOrThrow({ where: { title: "No link album" } });
    assert.equal(album.photoAlbumUrl, null);

    const bad = await runAs(admin, () =>
      albums.createAlbumAction({}, form({ title: "Bad link", eventDate: "2026-11-14", photoAlbumUrl: "javascript:alert(1)" })),
    );
    assert.deepEqual(bad, { error: "Enter a valid photo album link starting with https://" });
  });
});
