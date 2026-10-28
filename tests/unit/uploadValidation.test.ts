/*
 * The upload checks in src/lib/uploadValidation.ts, with real image files made
 * by sharp (and a real PDF made by pdf-lib), run both with sharp and with the
 * header-only fallback used when sharp can't be loaded.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import {
  FLYER_MEDIA_TYPES,
  IMAGE_MEDIA_TYPES,
  MAX_IMAGE_SIDE,
  MAX_UPLOAD_BYTES,
  UploadRejectedError,
  findPdfActiveFeature,
  isLosslessWebp,
  prepareUpload,
  prepareUploadBytes,
  readImageInfo,
  sniffMediaType,
  stripJpegMetadata,
  stripPngMetadata,
  type UploadRules,
} from "@/lib/uploadValidation";

const FLYER: UploadRules = { label: "Flyer", allowed: FLYER_MEDIA_TYPES };
const COVER: UploadRules = { label: "Cover image", allowed: IMAGE_MEDIA_TYPES, maxStoredSide: 3000, requireMetadataRemoval: true };

const bytes = (value: string) => Uint8Array.from(Buffer.from(value, "latin1"));
const join = (...parts: Uint8Array[]) => Uint8Array.from(Buffer.concat(parts));

function solid(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } });
}

/** A phone-like JPEG: 40×20 pixels stored sideways (orientation 6) with GPS, a comment and XMP. */
async function phoneJpeg() {
  const jpeg = await solid(40, 20)
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 44/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "73/1 59/1 0/1" } })
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF/></x:xmpmeta>')
    .toBuffer();
  // Add a comment segment after SOI, and a "motion photo" tail after the end of the picture.
  const text = Buffer.from("Taken at Prospect Park");
  const comment = Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, text.length + 2]), text]);
  return join(jpeg.subarray(0, 2), comment, jpeg.subarray(2), bytes("ftypmp42 secret video bytes"));
}

async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof UploadRejectedError, `expected an UploadRejectedError, got ${String(error)}`);
    return error.message;
  }
  assert.fail("expected the upload to be rejected");
}

async function animatedGif(frames: number, width = 10, height = 10) {
  const raw = Buffer.alloc(width * height * frames * 4);
  for (let f = 0; f < frames; f++) {
    for (let p = 0; p < width * height; p++) raw.set([f * 40, 90, 255 - f * 40, 255], (f * width * height + p) * 4);
  }
  return new Uint8Array(
    await sharp(raw, { raw: { width, height: height * frames, channels: 4, pageHeight: height } }).gif({ delay: 100 }).toBuffer(),
  );
}

/** GIF headers only: `frames` image descriptors on a width×height screen, nothing decodable. */
function gifHeaders(frames: number, width: number, height: number) {
  const parts = [bytes("GIF89a"), Uint8Array.from([width & 0xff, width >> 8, height & 0xff, height >> 8, 0, 0, 0])];
  for (let i = 0; i < frames; i++) {
    parts.push(Uint8Array.from([0x2c, 0, 0, 0, 0, width & 0xff, width >> 8, height & 0xff, height >> 8, 0, 2, 2, 0x4c, 0x01, 0]));
  }
  parts.push(Uint8Array.from([0x3b]));
  return join(...parts);
}

/** A PNG signature and IHDR claiming width×height, then nothing — a file a decoder would expand enormously. */
function pngHeader(width: number, height: number) {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "latin1");
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr.set([8, 2, 0, 0, 0], 16);
  return join(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, bytes("IDAT"));
}

function minimalPdf(extra = "") {
  return bytes(
    "%PDF-1.4\n" +
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n" +
      "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n" +
      "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj\n" +
      extra +
      "trailer << /Root 1 0 R >>\n%%EOF\n",
  );
}

describe("sniffMediaType and readImageInfo", () => {
  it("recognize each accepted format by its bytes, with the same size sharp reads", async () => {
    const cases = [
      ["image/jpeg", await solid(33, 17).jpeg().toBuffer()],
      ["image/png", await solid(33, 17).png().toBuffer()],
      ["image/webp", await solid(33, 17).webp().toBuffer()],
      ["image/webp", await solid(33, 17).webp({ lossless: true }).toBuffer()],
      ["image/gif", await solid(33, 17).gif().toBuffer()],
    ] as const;
    for (const [type, buffer] of cases) {
      const file = new Uint8Array(buffer);
      assert.equal(sniffMediaType(file), type);
      assert.deepEqual(readImageInfo(file, type), { width: 33, height: 17, frames: 1 }, type);
    }
    const anim = await animatedGif(3);
    assert.deepEqual(readImageInfo(anim, "image/gif"), { width: 10, height: 10, frames: 3 });
    const animWebp = new Uint8Array(
      await sharp(Buffer.from(await sharp(anim, { animated: true }).webp().toBuffer()), { animated: true }).webp().toBuffer(),
    );
    assert.deepEqual(readImageInfo(animWebp, "image/webp"), { width: 10, height: 10, frames: 3 });
    assert.equal(sniffMediaType(minimalPdf()), "application/pdf");
  });

  it("recognize nothing else", () => {
    for (const other of ["<svg xmlns='http://www.w3.org/2000/svg'/>", "<!doctype html><p>hi", "BM....", "PK\u0003\u0004", ""]) {
      assert.equal(sniffMediaType(bytes(other)), null, other);
    }
  });
});

describe("prepareUploadBytes: what is turned away", () => {
  it("an empty file and an oversized one", async () => {
    assert.match(await rejection(prepareUploadBytes(new Uint8Array(), "image/png", FLYER, sharp)), /empty file/);
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    big.set([0xff, 0xd8, 0xff]);
    assert.equal(await rejection(prepareUploadBytes(big, "image/jpeg", FLYER, sharp)), "Flyer must be 8MB or smaller.");
  });

  it("a type the form doesn't take, with the same message as before", async () => {
    assert.equal(
      await rejection(prepareUploadBytes(minimalPdf(), "application/pdf", COVER, sharp)),
      "Cover image must be a JPEG, PNG, WEBP, or GIF.",
    );
    const bmp = join(bytes("BM"), new Uint8Array(60));
    assert.equal(
      await rejection(prepareUploadBytes(bmp, "image/bmp", FLYER, sharp)),
      "Flyer must be a JPEG, PNG, WEBP, GIF, or PDF.",
    );
  });

  it("a file of a kind the form doesn't take, whatever it's labeled as", async () => {
    // A PDF is a fine flyer but not a cover photo, even when it's named like one.
    assert.equal(
      await rejection(prepareUploadBytes(minimalPdf(), "image/png", COVER, sharp)),
      "Cover image must be a JPEG, PNG, WEBP, or GIF, and this file is really a PDF, whatever its name says.",
    );
    assert.equal(
      await rejection(prepareUploadBytes(minimalPdf(), "image/jpeg", COVER, null)),
      "Cover image must be a JPEG, PNG, WEBP, or GIF, and this file is really a PDF, whatever its name says.",
    );
    // Not one of the accepted kinds at all, labeled as one.
    assert.equal(
      await rejection(prepareUploadBytes(join(bytes("BM"), new Uint8Array(60)), "image/png", COVER, sharp)),
      "Cover image must be a JPEG, PNG, WEBP, or GIF, and this file isn't one, whatever its name says.",
    );
  });

  it("SVG, web pages and iPhone HEIC, under their own type or renamed as pictures", async () => {
    const svg = bytes('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    assert.match(await rejection(prepareUploadBytes(svg, "image/png", COVER, sharp)), /can't be an SVG/);
    assert.match(await rejection(prepareUploadBytes(svg, "image/svg+xml", FLYER, sharp)), /can't be an SVG/);
    assert.match(await rejection(prepareUploadBytes(bytes("<html><body>hi</body></html>"), "text/html", FLYER, sharp)), /web page/);
    const page = join(Uint8Array.from([0xef, 0xbb, 0xbf]), bytes("  <!DOCTYPE html><html><body>hi</body></html>")); // with a UTF-8 byte order mark
    assert.match(await rejection(prepareUploadBytes(page, "image/jpeg", FLYER, sharp)), /web page/);
    const heic = join(Uint8Array.from([0, 0, 0, 24]), bytes("ftypheic\u0000\u0000\u0000\u0000mif1heic"));
    assert.match(await rejection(prepareUploadBytes(heic, "image/jpeg", COVER, sharp)), /HEIC/);
    assert.match(await rejection(prepareUploadBytes(heic, "image/heic", FLYER, sharp)), /HEIC/);
    assert.match(await rejection(prepareUploadBytes(bytes("just text"), "image/gif", COVER, sharp)), /isn't one/);
  });

  it("pictures carrying markup or script (polyglots)", async () => {
    const jpeg = await solid(10, 10).jpeg().toBuffer();
    const withScript = join(jpeg.subarray(0, 2), Uint8Array.from([0xff, 0xfe, 0x00, 0x1b]), bytes("<script>alert(1)</script>"), jpeg.subarray(2));
    assert.match(await rejection(prepareUploadBytes(withScript, "image/jpeg", COVER, sharp)), /web code/);
    const gifar = join(new Uint8Array(await solid(10, 10).gif().toBuffer()), bytes("<html><body onload=x()>"));
    assert.match(await rejection(prepareUploadBytes(gifar, "image/gif", COVER, null)), /web code/);
  });

  it("images too large to decode safely, from the headers alone", async () => {
    assert.match(await rejection(prepareUploadBytes(pngHeader(10_000, 6_000), "image/png", COVER, sharp)), /10,000 × 6,000 pixels.*too large/);
    assert.match(await rejection(prepareUploadBytes(pngHeader(MAX_IMAGE_SIDE + 1, 10), "image/png", COVER, sharp)), /too large/);
    assert.match(await rejection(prepareUploadBytes(gifHeaders(301, 2, 2), "image/gif", COVER, sharp)), /301 frames/);
    assert.match(await rejection(prepareUploadBytes(gifHeaders(250, 500, 500), "image/gif", COVER, sharp)), /across 250 frames/);
  });

  it("damaged files", async () => {
    const jpeg = new Uint8Array(await solid(50, 50).jpeg().toBuffer());
    const cut = jpeg.subarray(0, jpeg.length - 40);
    assert.match(await rejection(prepareUploadBytes(cut, "image/jpeg", COVER, sharp)), /couldn't be read/);
    assert.match(await rejection(prepareUploadBytes(cut, "image/jpeg", COVER, null)), /couldn't be read/);
    assert.match(await rejection(prepareUploadBytes(jpeg.subarray(0, 20), "image/jpeg", COVER, sharp)), /couldn't be read/);
    assert.match(await rejection(prepareUploadBytes(pngHeader(10, 10), "image/png", COVER, sharp)), /couldn't be read/);
  });

  it("PDFs that run scripts, launch programs or carry attachments, however the name is spelled", async () => {
    const js = minimalPdf("4 0 obj << /S /JavaScript /JS (app.alert(1)) >> endobj\n");
    assert.match(await rejection(prepareUploadBytes(js, "application/pdf", FLYER, sharp)), /scripts.*\(JavaScript\)/);
    const escaped = minimalPdf("4 0 obj << /S /J#61vaScript /J#53 (x) >> endobj\n");
    assert.match(await rejection(prepareUploadBytes(escaped, "application/pdf", FLYER, sharp)), /JavaScript|JS/);
    const launch = minimalPdf("4 0 obj << /S /Launch /F (calc.exe) >> endobj\n");
    assert.match(await rejection(prepareUploadBytes(launch, "application/pdf", FLYER, sharp)), /\(Launch\)/);
    const attached = minimalPdf("4 0 obj << /Type /EmbeddedFile >> endobj\n");
    assert.match(await rejection(prepareUploadBytes(attached, "application/pdf", FLYER, sharp)), /EmbeddedFile/);
    const uri = minimalPdf("4 0 obj << /S /URI /URI (javascript:alert(1)) >> endobj\n");
    assert.match(await rejection(prepareUploadBytes(uri, "application/pdf", FLYER, sharp)), /web code/);
  });

  it("a PDF with no end-of-file marker", async () => {
    const truncated = bytes("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n");
    assert.match(await rejection(prepareUploadBytes(truncated, "application/pdf", FLYER, sharp)), /couldn't be read/);
  });

  it("an action can't hide behind a stream that never ends", async () => {
    // No endstream after it: the rest of the file is checked as ordinary objects.
    const unclosed = minimalPdf("4 0 obj << /Length 9 >>\nstream\nxxxxxxxxx\n5 0 obj << /S /JavaScript >> endobj\n");
    assert.equal(findPdfActiveFeature(unclosed), "JavaScript");
    // A closed stream first, then an unclosed one: only the closed body is skipped.
    const mixed = minimalPdf(
      "4 0 obj << /Length 3 >>\nstream\n/JS\nendstream\nendobj\n" + "5 0 obj << /Length 1 >>\r\nstream\r\nx /Launch\n",
    );
    assert.equal(findPdfActiveFeature(mixed), "Launch");
    // Each kind of line ending after `stream` starts a body; the body ends at the first endstream.
    for (const eol of ["\r\n", "\n", "\r"]) {
      const closed = minimalPdf(`4 0 obj << /Length 3 >> stream${eol}/JS endstream /Launch\nendobj\n`);
      assert.equal(findPdfActiveFeature(closed), "Launch", JSON.stringify(eol));
    }
  });

  it("checks a full-size file of unclosed streams quickly (once took minutes)", async () => {
    // The worst case for the old lazy regex: every `stream` rescanned the whole
    // rest of the file looking for an endstream that wasn't there.
    const opener = ">>\nstream\n";
    const head = "%PDF-1.4\n";
    const tail = "%%EOF\n";
    const crafted = (size: number) =>
      bytes(head + opener.repeat(Math.floor((size - head.length - tail.length) / opener.length)) + tail);
    const timed = <T>(fn: () => T) => {
      const started = performance.now();
      const value = fn();
      return { value, ms: performance.now() - started };
    };

    // 1MB first: the old regex took about 20 seconds on this, so a return to
    // it fails here quickly instead of hanging on the full-size file below.
    // The bounds are loose so a slow test machine can't make this flaky;
    // the linear scan takes a few milliseconds.
    const small = timed(() => findPdfActiveFeature(crafted(1024 * 1024)));
    assert.equal(small.value, null);
    assert.ok(small.ms < 2000, `1MB took ${Math.round(small.ms)} ms`);

    // The largest file accepted, through the whole PDF path: size, signature,
    // markup, end marker and actions.
    const full = crafted(MAX_UPLOAD_BYTES);
    assert.ok(full.length > MAX_UPLOAD_BYTES - opener.length && full.length <= MAX_UPLOAD_BYTES);
    const started = performance.now();
    const prepared = await prepareUploadBytes(full, "application/pdf", FLYER, null);
    const elapsed = performance.now() - started;
    assert.equal(prepared.contentType, "application/pdf");
    assert.ok(elapsed < 5000, `8MB took ${Math.round(elapsed)} ms`);
  });
});

describe("prepareUploadBytes: what is kept", () => {
  it("PDFs are checked but stored exactly as uploaded, never image-processed", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]).drawText("Pack 376 Pinewood Derby");
    const pdf = await doc.save();
    const prepared = await prepareUploadBytes(pdf, "application/pdf", FLYER, sharp);
    assert.deepEqual(prepared.bytes, pdf);
    assert.equal(prepared.contentType, "application/pdf");
    assert.equal(prepared.extension, "pdf");
    assert.equal(prepared.metadataRemoved, false);

    // Names inside a stream body (page drawing, fonts) aren't actions.
    const drawing = minimalPdf("4 0 obj << /Length 18 >>\nstream\n/JS 1 Tf (x) Tj\nendstream\nendobj\n");
    assert.equal((await prepareUploadBytes(drawing, "application/pdf", FLYER, sharp)).extension, "pdf");
  });

  it("a phone JPEG loses its GPS, comment, XMP and appended video, and is turned upright (sharp)", async () => {
    const original = await phoneJpeg();
    const before = await sharp(original).metadata();
    assert.equal(before.orientation, 6);
    assert.ok(before.exif && before.xmp, "fixture carries EXIF and XMP");

    const prepared = await prepareUploadBytes(original, "image/jpeg", COVER, sharp);
    assert.equal(prepared.contentType, "image/jpeg");
    assert.equal(prepared.extension, "jpg");
    assert.equal(prepared.metadataRemoved, true);
    const after = await sharp(prepared.bytes).metadata();
    assert.equal(after.exif, undefined);
    assert.equal(after.xmp, undefined);
    assert.equal(after.comments, undefined);
    assert.equal(after.orientation, undefined);
    assert.deepEqual([after.width, after.height], [20, 40], "pixels turned to match the old orientation");
    assert.ok(!Buffer.from(prepared.bytes).includes("secret video"), "appended data dropped");
  });

  it("the same JPEG without sharp: metadata segments and the tail are cut, orientation kept", async () => {
    const original = await phoneJpeg();
    const prepared = await prepareUploadBytes(original, "image/jpeg", COVER, null);
    assert.equal(prepared.metadataRemoved, true);
    const out = Buffer.from(prepared.bytes);
    assert.ok(!out.includes("Taken at"), "comment removed");
    assert.ok(!out.includes("xmpmeta"), "XMP removed");
    assert.ok(!out.includes("secret video"), "appended data removed");
    const after = await sharp(out).metadata();
    assert.equal(after.orientation, 6, "still shows the right way up");
    // Only the 6-byte EXIF header and a one-entry orientation IFD remain.
    assert.equal(after.exif?.length, 32);
    assert.deepEqual([after.width, after.height], [40, 20]);
    // Still a whole, decodable JPEG.
    assert.equal((await sharp(out).raw().toBuffer()).length, 40 * 20 * 3);
  });

  it("stripJpegMetadata copes with progressive JPEGs and leaves an upright photo without EXIF", async () => {
    const progressive = new Uint8Array(await solid(64, 48).jpeg({ progressive: true }).withExif({ IFD0: { Artist: "Someone" } }).toBuffer());
    const stripped = stripJpegMetadata(progressive);
    assert.ok(stripped);
    const meta = await sharp(Buffer.from(stripped)).metadata();
    assert.equal(meta.exif, undefined);
    assert.deepEqual([meta.width, meta.height], [64, 48]);
    assert.equal((await sharp(Buffer.from(stripped)).raw().toBuffer()).length, 64 * 48 * 3);
  });

  it("PNG text and EXIF chunks go, with sharp and without", async () => {
    const png = new Uint8Array(await solid(12, 8).png().withExif({ IFD0: { Copyright: "Home address" } }).toBuffer());
    assert.ok((await sharp(png).metadata()).exif);
    const viaSharp = await prepareUploadBytes(png, "image/png", COVER, sharp);
    assert.equal((await sharp(viaSharp.bytes).metadata()).exif, undefined);

    const withText = stripPngMetadata(png);
    assert.ok(withText);
    const fallback = await prepareUploadBytes(png, "image/png", COVER, null);
    assert.equal(fallback.metadataRemoved, true);
    assert.ok(!Buffer.from(fallback.bytes).includes("Home address"));
    const meta = await sharp(Buffer.from(fallback.bytes)).metadata();
    assert.equal(meta.exif, undefined);
    assert.deepEqual([meta.width, meta.height], [12, 8]);
  });

  it("WEBP and GIF are re-saved by sharp; without it they're stored as they came, and say so", async () => {
    const webp = new Uint8Array(await solid(16, 16).webp().withExif({ IFD0: { Copyright: "x" } }).toBuffer());
    const viaSharp = await prepareUploadBytes(webp, "image/webp", COVER, sharp);
    assert.equal(viaSharp.metadataRemoved, true);
    assert.equal((await sharp(viaSharp.bytes).metadata()).exif, undefined);
    const fallback = await prepareUploadBytes(webp, "image/webp", FLYER, null);
    assert.equal(fallback.metadataRemoved, false);
    assert.deepEqual(fallback.bytes, webp);
    // A cover photo is refused instead of being stored with its metadata.
    assert.match(await rejection(prepareUploadBytes(webp, "image/webp", COVER, null)), /can't be processed right now/);
  });

  it("animations keep every frame", async () => {
    const gif = await animatedGif(3);
    const prepared = await prepareUploadBytes(gif, "image/gif", FLYER, sharp);
    const meta = await sharp(prepared.bytes, { animated: true }).metadata();
    assert.equal(meta.pages, 3);
    assert.equal(prepared.contentType, "image/gif");
  });

  it("a lossless WEBP stays lossless, pixel for pixel; a lossy one stays lossy", async () => {
    // Sharp-edged lettering on white, the kind of flyer export that blurs when re-saved lossy.
    const raw = Buffer.alloc(32 * 32 * 3, 255);
    for (let y = 8; y < 24; y++) for (let x = 6; x < 26; x += 3) raw.set([0, 0, 0], (y * 32 + x) * 3);
    const pixels = sharp(raw, { raw: { width: 32, height: 32, channels: 3 } });

    const lossless = new Uint8Array(
      await pixels.clone().webp({ lossless: true }).withExif({ IFD0: { Copyright: "x" } }).toBuffer(),
    );
    assert.equal(isLosslessWebp(lossless), true);
    const kept = await prepareUploadBytes(lossless, "image/webp", FLYER, sharp);
    assert.equal(isLosslessWebp(kept.bytes), true);
    assert.equal((await sharp(kept.bytes).metadata()).exif, undefined);
    const decoded = await sharp(kept.bytes).removeAlpha().raw().toBuffer();
    assert.deepEqual(decoded, raw, "every pixel is unchanged");

    const lossy = new Uint8Array(await pixels.clone().webp({ quality: 80 }).toBuffer());
    assert.equal(isLosslessWebp(lossy), false);
    assert.equal(isLosslessWebp((await prepareUploadBytes(lossy, "image/webp", FLYER, sharp)).bytes), false);

    // Extended files: one with an alpha channel and EXIF (VP8X), and an animation (frames inside ANMF chunks).
    const withAlpha = new Uint8Array(
      await pixels.clone().ensureAlpha().webp({ lossless: true }).withExif({ IFD0: { Copyright: "x" } }).toBuffer(),
    );
    assert.equal(String.fromCharCode(...withAlpha.subarray(12, 16)), "VP8X");
    assert.equal(isLosslessWebp(withAlpha), true);
    const animation = new Uint8Array(await sharp(await animatedGif(2), { animated: true }).webp({ lossless: true }).toBuffer());
    assert.equal(isLosslessWebp(animation), true);
    const keptAnimation = await prepareUploadBytes(animation, "image/webp", FLYER, sharp);
    assert.equal(isLosslessWebp(keptAnimation.bytes), true);
    assert.equal((await sharp(keptAnimation.bytes, { animated: true }).metadata()).pages, 2);
    const lossyAnimation = new Uint8Array(await sharp(await animatedGif(2), { animated: true }).webp({ quality: 80 }).toBuffer());
    assert.equal(isLosslessWebp(lossyAnimation), false);
  });

  it("covers are scaled down to the stored size; flyers keep theirs", async () => {
    const wide = new Uint8Array(await solid(4000, 100).jpeg().toBuffer());
    const cover = await prepareUploadBytes(wide, "image/jpeg", COVER, sharp);
    const coverMeta = await sharp(cover.bytes).metadata();
    assert.deepEqual([coverMeta.width, coverMeta.height], [3000, 75]);
    const flyer = await prepareUploadBytes(wide, "image/jpeg", FLYER, sharp);
    assert.equal((await sharp(flyer.bytes).metadata()).width, 4000);
  });

  it("a file of a kind the form takes is accepted under any label, and stored as what it really is", async () => {
    // A PNG saved as .jpg (or renamed to get past a picky form) is still a PNG.
    const png = new Uint8Array(await solid(10, 10).png().withExif({ IFD0: { Copyright: "x" } }).toBuffer());
    for (const label of ["image/jpeg", "image/webp", "application/pdf", "application/octet-stream", ""]) {
      const prepared = await prepareUploadBytes(png, label, COVER, sharp);
      assert.equal(prepared.contentType, "image/png", label);
      assert.equal(prepared.extension, "png", label);
      assert.equal(prepared.metadataRemoved, true, label);
      const meta = await sharp(prepared.bytes).metadata();
      assert.equal(meta.format, "png", label);
      assert.equal(meta.exif, undefined, label);
    }
    // The same without sharp: the PNG fallback strips it as a PNG.
    const fallback = await prepareUploadBytes(png, "image/jpeg", COVER, null);
    assert.deepEqual([fallback.contentType, fallback.extension, fallback.metadataRemoved], ["image/png", "png", true]);

    const webp = new Uint8Array(await solid(10, 10).webp().toBuffer());
    const asJpeg = await prepareUploadBytes(webp, "image/jpeg", COVER, sharp);
    assert.deepEqual([asJpeg.contentType, asJpeg.extension], ["image/webp", "webp"]);

    // A PDF flyer labeled as a picture is a PDF flyer, stored exactly as uploaded…
    const pdf = minimalPdf();
    const pdfFlyer = await prepareUploadBytes(pdf, "image/png", FLYER, sharp);
    assert.deepEqual([pdfFlyer.contentType, pdfFlyer.extension, pdfFlyer.metadataRemoved], ["application/pdf", "pdf", false]);
    assert.deepEqual(pdfFlyer.bytes, pdf);
    // …and still has to pass the PDF checks.
    const js = minimalPdf("4 0 obj << /S /JavaScript /JS (app.alert(1)) >> endobj\n");
    assert.match(await rejection(prepareUploadBytes(js, "image/jpeg", FLYER, sharp)), /scripts.*\(JavaScript\)/);

    // A picture labeled as a PDF is a picture, cleaned like any other.
    const jpeg = await phoneJpeg();
    const jpegFlyer = await prepareUploadBytes(jpeg, "application/pdf", FLYER, sharp);
    assert.deepEqual([jpegFlyer.contentType, jpegFlyer.extension, jpegFlyer.metadataRemoved], ["image/jpeg", "jpg", true]);
    assert.equal((await sharp(jpegFlyer.bytes).metadata()).exif, undefined);
  });

  it("accepts older browsers' names for JPEG and PNG", async () => {
    const jpeg = new Uint8Array(await solid(10, 10).jpeg().toBuffer());
    assert.equal((await prepareUploadBytes(jpeg, "image/jpg", COVER, sharp)).contentType, "image/jpeg");
    assert.equal((await prepareUploadBytes(jpeg, "IMAGE/PJPEG", COVER, sharp)).contentType, "image/jpeg");
  });
});

describe("prepareUpload", () => {
  it("reads a File, loads sharp itself and checks the size before reading", async () => {
    const original = await phoneJpeg();
    const file = new File([Buffer.from(original)], "IMG_0001.jpg", { type: "image/jpeg" });
    const prepared = await prepareUpload(file, COVER);
    assert.equal(prepared.metadataRemoved, true);
    assert.equal((await sharp(prepared.bytes).metadata()).exif, undefined);

    const tooBig = new File([new Uint8Array(9 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" });
    assert.equal(await rejection(prepareUpload(tooBig, COVER)), "Cover image must be 8MB or smaller.");
  });
});
