/*
 * Flyer and album cover uploads against a real database: only checked,
 * cleaned files are stored; a cover uploaded for a save that then fails is
 * removed again; and album edits racing each other and deletes (two
 * connections, real row locks) never delete a cover in use or leave a
 * replaced one behind.
 *
 * The fake @vercel/blob (tests/support/mocks/blob.mjs) hands out URLs on
 * test.public.blob.vercel-storage.com; TEST_BLOB_HOSTNAME lets blobCleanup.ts
 * treat that stand-in store as ours (only under NODE_ENV=test).
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import sharp from "sharp";
import { openTransaction, waitForLockWait, withTestDatabase } from "../support/db";
import { form, resetTestState, runAs, settle, testState, type SessionUser } from "../support/context";

process.env.TEST_BLOB_HOSTNAME = "test.public.blob.vercel-storage.com";

const db = withTestDatabase("uploads");

let flyerUpload: typeof import("@/lib/flyerUpload");
let albums: typeof import("@/lib/actions/albums");
let validation: typeof import("@/lib/uploadValidation");

let admin: SessionUser;
let photographer: SessionUser;
let tripViewer: SessionUser;

const REAL = "https://jyclzu7uphezevn7.public.blob.vercel-storage.com";
let serial = 0;
const realUrl = (prefix = "album-covers") => `${REAL}/${prefix}/${(serial += 1)}-${Date.now()}.jpg`;

before(async () => {
  await db.ready;
  flyerUpload = await import("@/lib/flyerUpload");
  albums = await import("@/lib/actions/albums");
  validation = await import("@/lib/uploadValidation");

  const make = async (username: string, role: SessionUser["role"]) => {
    const user = await db.prisma.user.create({ data: { username, passwordHash: "x", role, displayName: username } });
    return { id: user.id, role, sessionVersion: 0 };
  };
  admin = await make("uploads-admin", "ADMIN");
  photographer = await make("uploads-photographer", "PHOTOGRAPHER");
  tripViewer = await make("uploads-tripviewer", "TRIP_VIEWER");
});

beforeEach(async () => {
  resetTestState();
  await db.prisma.pendingBlobDeletion.deleteMany();
});

async function jpegFile(name = "IMG_0001.jpg", width = 40, height = 30) {
  const jpeg = await sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 60 } } })
    .jpeg()
    .withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 39/1 0/1" } })
    .toBuffer();
  return new File([jpeg], name, { type: "image/jpeg" });
}

function albumForm(values: Record<string, string>, cover?: File) {
  const data = form({ title: "Pinewood Derby", eventDate: "2026-11-14", photoAlbumUrl: "https://photos.example.org/s/abc", ...values });
  if (cover) data.set("coverImage", cover);
  return data;
}

/** A Server Action's outcome: its returned state, or "redirect" when it finished by redirecting. */
async function outcome<T>(promise: Promise<T>): Promise<T | "redirect"> {
  const result = await settle(promise);
  if (result.ok) return result.value;
  if ((result.error as Error & { redirect?: string }).redirect) return "redirect";
  throw result.error;
}

/** Waits until at least `count` other connections are blocked on a lock. */
async function waitForLockWaiters(count: number) {
  const started = Date.now();
  for (;;) {
    const { rows } = await db.pool.query(
      `SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
    );
    if (rows[0].waiting >= count) return;
    if (Date.now() - started > 5000) throw new Error(`Timed out waiting for ${count} blocked connections`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function makeAlbum(coverImageUrl: string | null = realUrl()) {
  return db.prisma.photoAlbum.create({
    data: { title: "Fall Campout", eventDate: new Date("2026-10-10T00:00:00Z"), photoAlbumUrl: "https://photos.example.org/s/x", coverImageUrl },
  });
}

describe("uploadFlyer", () => {
  it("stores a checked, cleaned image under its real type and extension", async () => {
    const png = await sharp({ create: { width: 30, height: 20, channels: 3, background: "#123456" } })
      .png()
      .withExif({ IFD0: { Copyright: "x" } })
      .toBuffer();
    const url = await flyerUpload.uploadFlyer(new File([png], "flyer.png", { type: "image/png" }), "event-flyers");
    assert.equal(testState.blobPuts.length, 1);
    const [stored] = testState.blobPuts;
    assert.equal(stored.url, url);
    assert.match(stored.pathname, /^event-flyers\/[0-9a-f-]{36}\.png$/);
    assert.equal(stored.options?.contentType, "image/png");
  });

  it("stores a PDF flyer as a PDF", async () => {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n", "latin1");
    await flyerUpload.uploadFlyer(new File([pdf], "flyer.pdf", { type: "application/pdf" }), "trip-flyers");
    assert.match(testState.blobPuts[0].pathname, /^trip-flyers\/[0-9a-f-]{36}\.pdf$/);
    assert.equal(testState.blobPuts[0].options?.contentType, "application/pdf");
    assert.equal(testState.blobPuts[0].size, pdf.length, "stored exactly as uploaded");
  });

  it("refuses a disguised or active file with a readable message, uploading nothing", async () => {
    const page = new File(["<html><script>steal()</script></html>"], "flyer.jpg", { type: "image/jpeg" });
    await assert.rejects(flyerUpload.uploadFlyer(page, "event-flyers"), (error: Error) => {
      assert.ok(error instanceof validation.UploadRejectedError);
      assert.match(error.message, /web page/);
      return true;
    });
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "flyer.png", { type: "image/png" });
    await assert.rejects(flyerUpload.uploadFlyer(svg, "event-flyers"), /SVG/);
    assert.equal(testState.blobPuts.length, 0);
  });
});

describe("album actions", () => {
  it("only album editors can add one; nothing is uploaded for anyone else", async () => {
    const result = await outcome(runAs(tripViewer, async () => albums.createAlbumAction({}, albumForm({}, await jpegFile()))));
    assert.deepEqual(result, { error: "Not authorized." });
    assert.equal(testState.blobPuts.length, 0);
    await assert.rejects(
      runAs(photographer, () => albums.deleteAlbumAction(form({ albumId: "x" }))),
      /Not authorized: admin only/,
    );
  });

  it("adds an album with a cleaned cover photo", async () => {
    const result = await outcome(
      runAs(photographer, async () => albums.createAlbumAction({}, albumForm({ title: "Cover test" }, await jpegFile()))),
    );
    assert.equal(result, "redirect");
    const album = await db.prisma.photoAlbum.findFirstOrThrow({ where: { title: "Cover test" } });
    assert.equal(album.coverImageUrl, testState.blobPuts[0].url);
    assert.match(testState.blobPuts[0].pathname, /^album-covers\/[0-9a-f-]{36}\.jpg$/);
    const entry = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "album.create", entityId: album.id } });
    assert.match(JSON.stringify(entry.details), /photo details removed/);
  });

  it("checks the text fields before uploading anything", async () => {
    const result = await outcome(runAs(admin, async () => albums.createAlbumAction({}, albumForm({ title: "x".repeat(121) }, await jpegFile()))));
    assert.deepEqual(result, { error: "Keep the title to 120 characters or fewer." });
    const badDate = await outcome(runAs(admin, async () => albums.createAlbumAction({}, albumForm({ eventDate: "2026-02-31" }, await jpegFile()))));
    assert.deepEqual(badDate, { error: "Enter a valid event date." });
    const badLink = await outcome(runAs(admin, async () => albums.createAlbumAction({}, albumForm({ photoAlbumUrl: "javascript:alert(1)" }))));
    assert.deepEqual(badLink, { error: "Enter a valid photo album link starting with https://" });
    assert.equal(testState.blobPuts.length, 0);
  });

  it("refuses a cover that isn't really a picture, with the reason", async () => {
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>'], "cover.jpg", { type: "image/jpeg" });
    const result = await outcome(runAs(admin, () => albums.createAlbumAction({}, albumForm({ title: "SVG cover" }, svg))));
    assert.ok(result !== "redirect" && /SVG/.test(result.error ?? ""), JSON.stringify(result));
    assert.equal(testState.blobPuts.length, 0);
    assert.equal(await db.prisma.photoAlbum.count({ where: { title: "SVG cover" } }), 0);
  });

  it("deletes the new cover again when the album can't be saved", async (t) => {
    await db.pool.query(`CREATE OR REPLACE FUNCTION uploads_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated database failure'; END $$`);
    await db.pool.query(`CREATE TRIGGER uploads_test_fail BEFORE INSERT OR UPDATE ON "PhotoAlbum" FOR EACH ROW EXECUTE FUNCTION uploads_test_fail()`);
    t.after(() => db.pool.query(`DROP TRIGGER IF EXISTS uploads_test_fail ON "PhotoAlbum"`));

    const result = await outcome(runAs(admin, async () => albums.createAlbumAction({}, albumForm({ title: "Doomed" }, await jpegFile()))));
    assert.deepEqual(result, { error: "The album couldn't be saved. Please try again." });
    assert.equal(testState.blobPuts.length, 1);
    assert.deepEqual(testState.blobDeletes, [testState.blobPuts[0].url], "the orphan was removed");
    assert.equal(await db.prisma.photoAlbum.count({ where: { title: "Doomed" } }), 0);

    // An edit that fails the same way also cleans up, and leaves the old cover alone.
    resetTestState();
    const oldCover = realUrl();
    await db.pool.query(`ALTER TABLE "PhotoAlbum" DISABLE TRIGGER uploads_test_fail`);
    const album = await makeAlbum(oldCover);
    await db.pool.query(`ALTER TABLE "PhotoAlbum" ENABLE TRIGGER uploads_test_fail`);
    const edit = await outcome(runAs(admin, async () => albums.updateAlbumAction({}, albumForm({ albumId: album.id }, await jpegFile()))));
    assert.deepEqual(edit, { error: "The changes couldn't be saved. Please try again." });
    assert.deepEqual(testState.blobDeletes, [testState.blobPuts[0].url]);
    assert.equal((await db.prisma.photoAlbum.findUniqueOrThrow({ where: { id: album.id } })).coverImageUrl, oldCover);
  });

  it("replacing a cover deletes the old one after the save, logged with the change", async () => {
    const oldCover = realUrl();
    const album = await makeAlbum(oldCover);
    const result = await outcome(runAs(admin, async () => albums.updateAlbumAction({}, albumForm({ albumId: album.id, title: "Renamed" }, await jpegFile()))));
    assert.equal(result, "redirect");
    const saved = await db.prisma.photoAlbum.findUniqueOrThrow({ where: { id: album.id } });
    assert.equal(saved.coverImageUrl, testState.blobPuts[0].url);
    assert.equal(saved.title, "Renamed");
    assert.deepEqual(testState.blobDeletes, [oldCover]);
    assert.equal(await db.prisma.auditLog.count({ where: { action: "album.update", entityId: album.id } }), 1);

    // Saving without a new file keeps the cover and deletes nothing.
    resetTestState();
    await outcome(runAs(admin, () => albums.updateAlbumAction({}, albumForm({ albumId: album.id, title: "Again" }))));
    assert.equal((await db.prisma.photoAlbum.findUniqueOrThrow({ where: { id: album.id } })).coverImageUrl, saved.coverImageUrl);
    assert.deepEqual(testState.blobDeletes, []);
  });

  it("an edit that waited on a delete reports the album gone and removes its own upload", async (t) => {
    const oldCover = realUrl();
    const album = await makeAlbum(oldCover);
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(`DELETE FROM "PhotoAlbum" WHERE "id" = $1`, [album.id]);

    const cover = await jpegFile();
    const editing = outcome(runAs(admin, () => albums.updateAlbumAction({}, albumForm({ albumId: album.id }, cover))));
    await waitForLockWait(db.pool);
    await holder.commit();

    assert.deepEqual(await editing, { error: "This album no longer exists — someone may have just deleted it." });
    assert.equal(await db.prisma.photoAlbum.count({ where: { id: album.id } }), 0);
    assert.deepEqual(testState.blobDeletes, [testState.blobPuts[0].url], "the edit's upload, nothing else");
  });

  it("an edit that waited on another cover change deletes the cover that change put in", async (t) => {
    const original = realUrl();
    const theirs = realUrl();
    const album = await makeAlbum(original);
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(`UPDATE "PhotoAlbum" SET "coverImageUrl" = $2 WHERE "id" = $1`, [album.id, theirs]);

    const editing = outcome(runAs(admin, async () => albums.updateAlbumAction({}, albumForm({ albumId: album.id }, await jpegFile()))));
    await waitForLockWait(db.pool);
    await holder.commit();
    assert.equal(await editing, "redirect");

    const ours = testState.blobPuts[0].url;
    assert.equal((await db.prisma.photoAlbum.findUniqueOrThrow({ where: { id: album.id } })).coverImageUrl, ours);
    assert.deepEqual(testState.blobDeletes, [theirs], "the cover it actually replaced, not the one it first saw");
  });

  it("reverse order: a delete that waited on an edit removes the edit's new cover", async (t) => {
    const original = realUrl();
    const album = await makeAlbum(original);
    // Hold the edit inside its transaction (after it has locked the album) by
    // blocking its audit-log insert.
    const holder = await openTransaction(db.pool);
    t.after(() => holder.rollback());
    await holder.query(`LOCK TABLE "AuditLog" IN EXCLUSIVE MODE`);

    const editing = outcome(runAs(admin, async () => albums.updateAlbumAction({}, albumForm({ albumId: album.id }, await jpegFile()))));
    await waitForLockWaiters(1);
    const deleting = outcome(runAs(admin, () => albums.deleteAlbumAction(form({ albumId: album.id }))));
    await waitForLockWaiters(2);
    await holder.rollback();

    assert.equal(await editing, "redirect");
    await deleting;
    const newCover = testState.blobPuts[0].url;
    assert.equal(await db.prisma.photoAlbum.count({ where: { id: album.id } }), 0);
    assert.deepEqual(new Set(testState.blobDeletes), new Set([original, newCover]));
    assert.equal(await db.prisma.auditLog.count({ where: { action: "album.delete", entityId: album.id } }), 1);
  });

  it("deleting twice at once deletes once", async () => {
    const cover = realUrl();
    const album = await makeAlbum(cover);
    await Promise.all([
      runAs(admin, () => albums.deleteAlbumAction(form({ albumId: album.id }))),
      runAs(admin, () => albums.deleteAlbumAction(form({ albumId: album.id }))),
    ]);
    assert.deepEqual(testState.blobDeletes, [cover]);
    assert.equal(await db.prisma.auditLog.count({ where: { action: "album.delete", entityId: album.id } }), 1);
  });

  it("stress: concurrent cover changes and deletes never delete a cover in use or leave one behind", async () => {
    const coverFile = await jpegFile();
    for (let round = 0; round < 20; round++) {
      resetTestState();
      const original = realUrl();
      const album = await makeAlbum(original);
      const actions = [
        outcome(runAs(admin, () => albums.updateAlbumAction({}, albumForm({ albumId: album.id }, coverFile)))),
        outcome(runAs(photographer, () => albums.updateAlbumAction({}, albumForm({ albumId: album.id }, coverFile)))),
        ...(round % 2 === 0 ? [outcome(runAs(admin, () => albums.deleteAlbumAction(form({ albumId: album.id }))))] : []),
      ];
      await Promise.all(actions);

      const final = (await db.prisma.photoAlbum.findUnique({ where: { id: album.id } }))?.coverImageUrl ?? null;
      const uploaded = [original, ...testState.blobPuts.map((p) => p.url)];
      const deleted = new Set(testState.blobDeletes);
      if (final) assert.ok(!deleted.has(final), `round ${round}: the cover in use was deleted`);
      for (const url of uploaded) {
        if (url !== final) assert.ok(deleted.has(url), `round ${round}: ${url} left behind`);
      }
      assert.equal(testState.blobDeletes.length, deleted.size, `round ${round}: something deleted twice`);
      assert.equal(await db.prisma.pendingBlobDeletion.count(), 0);
    }
  });

  it("show/hide checks its input and says when the album is gone", async () => {
    const album = await makeAlbum(null);
    assert.deepEqual(await runAs(photographer, () => albums.toggleAlbumVisibilityAction(album.id, false)), { ok: true });
    assert.equal((await db.prisma.photoAlbum.findUniqueOrThrow({ where: { id: album.id } })).isVisible, false);
    const bad = await runAs(admin, () => albums.toggleAlbumVisibilityAction(album.id, "yes" as unknown as boolean));
    assert.equal(bad.ok, false);
    const gone = await runAs(admin, () => albums.toggleAlbumVisibilityAction("no-such-album", true));
    assert.deepEqual(gone, { ok: false, error: "This album no longer exists — reload the page." });
    const refused = await runAs(tripViewer, () => albums.toggleAlbumVisibilityAction(album.id, true));
    assert.deepEqual(refused, { ok: false, error: "Not authorized." });
  });

  it("the album forms give the browser the same length limits the save enforces", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { ALBUM_FIELD_LIMITS } = await import("@/lib/albumFields");
    const { default: EditAlbumForm } = await import("@/components/EditAlbumForm");
    const { default: NewAlbumPage } = await import("@/app/portal/(authed)/admin/albums/new/page");
    assert.deepEqual({ ...ALBUM_FIELD_LIMITS }, { title: 120, description: 2000, photoAlbumUrl: 2048 });

    const album = await makeAlbum(null);
    for (const html of [renderToStaticMarkup(createElement(EditAlbumForm, { album })), renderToStaticMarkup(createElement(NewAlbumPage))]) {
      for (const [id, limit] of Object.entries(ALBUM_FIELD_LIMITS)) {
        const field = new RegExp(`<(input|textarea)[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0];
        assert.ok(field, `no ${id} field`);
        assert.match(field, new RegExp(`\\bmaxLength="${limit}"`, "i"), `${id} has no maxLength of ${limit}`);
      }
    }

    // Exactly at each limit is accepted; one over is refused.
    const link = "https://photos.example.org/s/";
    const atLimits = await outcome(
      runAs(admin, () =>
        albums.createAlbumAction(
          {},
          albumForm({ title: "T".repeat(120), photoAlbumUrl: link + "a".repeat(2048 - link.length) }),
        ),
      ),
    );
    assert.equal(atLimits, "redirect");
    const longLink = await outcome(
      runAs(admin, () => albums.createAlbumAction({}, albumForm({ photoAlbumUrl: link + "a".repeat(2049 - link.length) }))),
    );
    assert.deepEqual(longLink, { error: "Enter a valid photo album link starting with https://" });

    // A description the browser counts as 2,000 characters arrives longer,
    // because each line break is sent as CRLF; it's accepted and stored with LF.
    // Nine 199-character lines and one of 200, with nine line breaks between them.
    const browserCounted = Array(9).fill("x".repeat(199)).join("\n") + "\n" + "y".repeat(200);
    assert.equal(browserCounted.length, 2000);
    const sent = browserCounted.replace(/\n/g, "\r\n");
    assert.ok(sent.length > 2000);
    const saved = await outcome(
      runAs(admin, () => albums.createAlbumAction({}, albumForm({ title: "Long description", description: sent }))),
    );
    assert.equal(saved, "redirect");
    const stored = await db.prisma.photoAlbum.findFirstOrThrow({ where: { title: "Long description" } });
    assert.equal(stored.description, browserCounted);
    const tooLong = await outcome(
      runAs(admin, () => albums.createAlbumAction({}, albumForm({ description: browserCounted + "z" }))),
    );
    assert.deepEqual(tooLong, { error: "Keep the description to 2,000 characters or fewer." });

    // An older description saved with CRLF isn't logged as edited when only the line endings change.
    await db.prisma.photoAlbum.update({ where: { id: album.id }, data: { description: "Line one\r\nLine two" } });
    const resaved = await outcome(
      runAs(admin, () =>
        albums.updateAlbumAction(
          {},
          albumForm({ albumId: album.id, title: "Fall Campout", eventDate: "2026-10-10", photoAlbumUrl: "https://photos.example.org/s/x", description: "Line one\r\nLine two" }),
        ),
      ),
    );
    assert.equal(resaved, "redirect");
    assert.equal((await db.prisma.photoAlbum.findUniqueOrThrow({ where: { id: album.id } })).description, "Line one\nLine two");
    const entry = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "album.update", entityId: album.id } });
    assert.doesNotMatch(JSON.stringify(entry.details), /Description/);
  });
});
