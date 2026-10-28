import "server-only";
import { crc32 } from "node:zlib";

/*
 * What an uploaded flyer or cover photo has to be before it is stored.
 *
 * File.type and the filename are whatever the browser — or anyone posting to
 * a Server Action directly — says they are, so both are only a claim. The
 * file's own first bytes (its signature) decide what it really is, and only
 * that decides whether it's accepted: a web page or SVG renamed to .jpg is
 * turned away with a message the admin can act on, and so is a PDF chosen as
 * an album cover, whatever it's called. A file that really is a kind the
 * upload takes is accepted under any name — a PNG saved as .jpg, a PDF flyer
 * labeled as an image — and stored as what it really is, with that type and
 * extension.
 *
 * Images are then decoded and saved again with sharp (already installed as
 * Next.js's image library). That drops everything that isn't the picture:
 * EXIF — including GPS position, on a phone photo of children at a pack
 * event — comments, and anything tucked into or appended to the file. Their
 * pixel size is checked from the headers first, before anything decodes them,
 * so a small file that unpacks into an enormous image is refused cheaply.
 *
 * If sharp can't be loaded, JPEG and PNG metadata is still removed by
 * rewriting the file's segments without the metadata ones (see
 * stripJpegMetadata/stripPngMetadata); WEBP and GIF are then stored as they
 * came, or refused where the rules say metadata must go (album covers). PDFs
 * never go through image processing: they're checked for a real
 * PDF signature and for scripts, attachments and launch actions, and are
 * stored as uploaded.
 */

export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
export type UploadMediaType = ImageMediaType | "application/pdf";

export const IMAGE_MEDIA_TYPES: readonly ImageMediaType[] = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const FLYER_MEDIA_TYPES: readonly UploadMediaType[] = [...IMAGE_MEDIA_TYPES, "application/pdf"];

const TYPE_NAMES: Record<UploadMediaType, string> = {
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WEBP",
  "image/gif": "GIF",
  "application/pdf": "PDF",
};

const EXTENSIONS: Record<UploadMediaType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

/** Older browsers' names for the same types. */
const TYPE_ALIASES: Record<string, UploadMediaType> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
};

/** The largest upload accepted; matches the Server Actions body limit in next.config.ts. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** Longest side, in pixels, of an accepted image. A 24x36 poster at 300 dpi is 10,800. */
export const MAX_IMAGE_SIDE = 12_000;
/**
 * Most pixels in an accepted image, counting every frame of an animation.
 * Decoding takes about 4 bytes a pixel, so this keeps one upload to roughly
 * 200 MB of memory. A 48-megapixel phone photo fits.
 */
export const MAX_IMAGE_PIXELS = 50_000_000;
export const MAX_ANIMATION_FRAMES = 300;

/** A file turned down for a reason the person uploading it can act on; the message says what to do. */
export class UploadRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadRejectedError";
  }
}

export type UploadRules = {
  /** What is being uploaded, as the start of a sentence: "Flyer", "Cover image". */
  label: string;
  allowed: readonly UploadMediaType[];
  maxBytes?: number;
  /** Scale stored images down (never up) so neither side is longer than this. */
  maxStoredSide?: number;
  /**
   * Refuse an image whose metadata can't be removed (a WEBP or GIF when sharp
   * isn't available) rather than store it with its EXIF. For photos of people.
   */
  requireMetadataRemoval?: boolean;
};

export type PreparedUpload = {
  /** What to store: the re-saved image, or the PDF exactly as uploaded. */
  bytes: Uint8Array;
  contentType: UploadMediaType;
  /** File extension for the stored name, from what the file really is. */
  extension: string;
  /** Whether the stored image is free of the original's metadata (EXIF/GPS, comments). Always false for a PDF. */
  metadataRemoved: boolean;
};

export type ImageInfo = { width: number; height: number; frames: number };

/** sharp's default export (the function that opens an image). */
export type SharpConstructor = (typeof import("sharp"))["default"];

// ---------------------------------------------------------------------------
// Reading what a file really is

function ascii(bytes: Uint8Array, start: number, length: number) {
  let out = "";
  for (let i = start; i < start + length && i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u32le = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The type the file's signature says it is, or null for anything that isn't one of the five accepted kinds. */
export function sniffMediaType(bytes: Uint8Array): UploadMediaType | null {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 16 && PNG_SIGNATURE.every((v, i) => bytes[i] === v) && ascii(bytes, 12, 4) === "IHDR") {
    return "image/png";
  }
  const gif = ascii(bytes, 0, 6);
  if (bytes.length >= 13 && (gif === "GIF87a" || gif === "GIF89a")) return "image/gif";
  if (
    bytes.length >= 30 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WEBP" &&
    ["VP8 ", "VP8L", "VP8X"].includes(ascii(bytes, 12, 4))
  ) {
    return "image/webp";
  }
  if (bytes.length >= 8 && ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

/** A plain-words name for a file that isn't one of the accepted kinds, when it's a common one. */
function describeOtherFile(bytes: Uint8Array): "svg" | "webpage" | "heic" | "avif" | "other" {
  let start = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3; // UTF-8 byte order mark
  const head = ascii(bytes, start, 1024).trimStart().toLowerCase();
  if (head.includes("<svg")) return "svg";
  if (/^<(!doctype|html|head|body|script|iframe|\?xml)/.test(head)) return "webpage";
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "heic";
    if (brand === "avif" || brand === "avis") return "avif";
  }
  return "other";
}

/**
 * Width, height and frame count from the file's own headers, without
 * decoding the picture. Null when the headers are missing, cut short or
 * inconsistent — the file isn't safe to hand to a decoder.
 */
export function readImageInfo(bytes: Uint8Array, type: ImageMediaType): ImageInfo | null {
  switch (type) {
    case "image/jpeg":
      return jpegInfo(bytes);
    case "image/png":
      return pngInfo(bytes);
    case "image/gif":
      return gifInfo(bytes);
    case "image/webp":
      return webpInfo(bytes);
  }
}

/** SOF markers carry the frame size: C0–CF except DHT (C4), JPG (C8) and DAC (CC). */
function isJpegFrameMarker(marker: number) {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function isStandaloneJpegMarker(marker: number) {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

function jpegInfo(b: Uint8Array): ImageInfo | null {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (isStandaloneJpegMarker(marker)) {
      i += 2;
      continue;
    }
    // The image data (SOS) or its end (EOI) before any frame header: no size to read.
    if (marker === 0xda || marker === 0xd9 || marker === 0xd8) return null;
    const length = u16be(b, i + 2);
    if (length < 2 || i + 2 + length > b.length) return null;
    if (isJpegFrameMarker(marker)) {
      if (length < 8) return null;
      const height = u16be(b, i + 5);
      const width = u16be(b, i + 7);
      return width > 0 && height > 0 ? { width, height, frames: 1 } : null;
    }
    i += 2 + length;
  }
  return null;
}

function pngInfo(b: Uint8Array): ImageInfo | null {
  if (b.length < 33 || u32be(b, 8) !== 13) return null;
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  if (width === 0 || height === 0 || width > 0x7fffffff || height > 0x7fffffff) return null;
  // Only the first frame of an animated PNG is ever decoded, so it counts as one.
  return { width, height, frames: 1 };
}

/** Skips GIF data sub-blocks starting at i; returns the index after the terminator, or -1 if cut short. */
function skipGifSubBlocks(b: Uint8Array, i: number) {
  while (i < b.length) {
    const size = b[i];
    i += 1;
    if (size === 0) return i;
    i += size;
  }
  return -1;
}

function gifInfo(b: Uint8Array): ImageInfo | null {
  let width = u16le(b, 6);
  let height = u16le(b, 8);
  const flags = b[10];
  let i = 13;
  if (flags & 0x80) i += 3 * (1 << ((flags & 0x07) + 1)); // global colour table
  let frames = 0;
  while (i < b.length) {
    const block = b[i];
    i += 1;
    if (block === 0x3b) break; // trailer
    if (block === 0x21) {
      // Extension: a label byte, then sub-blocks.
      i = skipGifSubBlocks(b, i + 1);
      if (i < 0) return null;
    } else if (block === 0x2c) {
      if (i + 9 > b.length) return null;
      const left = u16le(b, i);
      const top = u16le(b, i + 2);
      const frameWidth = u16le(b, i + 4);
      const frameHeight = u16le(b, i + 6);
      const frameFlags = b[i + 8];
      i += 9;
      if (frameFlags & 0x80) i += 3 * (1 << ((frameFlags & 0x07) + 1)); // local colour table
      i = skipGifSubBlocks(b, i + 1); // LZW code size, then the image data
      if (i < 0) return null;
      // A frame drawn past the stated screen still has to be decoded at full size.
      width = Math.max(width, left + frameWidth);
      height = Math.max(height, top + frameHeight);
      frames += 1;
    } else {
      return null;
    }
  }
  if (frames === 0 || width === 0 || height === 0) return null;
  return { width, height, frames };
}

function webpInfo(b: Uint8Array): ImageInfo | null {
  const riffSize = u32le(b, 4);
  if (riffSize + 8 > b.length + 1 || riffSize < 12) return null;
  const end = Math.min(b.length, riffSize + 8);
  const first = ascii(b, 12, 4);
  const data = 20;
  if (first === "VP8 ") {
    if (data + 10 > end || b[data + 3] !== 0x9d || b[data + 4] !== 0x01 || b[data + 5] !== 0x2a) return null;
    const width = u16le(b, data + 6) & 0x3fff;
    const height = u16le(b, data + 8) & 0x3fff;
    return width && height ? { width, height, frames: 1 } : null;
  }
  if (first === "VP8L") {
    if (data + 5 > end || b[data] !== 0x2f) return null;
    const bits = u32le(b, data + 1);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, frames: 1 };
  }
  if (first === "VP8X") {
    if (data + 10 > end) return null;
    const width = u24le(b, data + 4) + 1;
    const height = u24le(b, data + 7) + 1;
    // Count the animation frames (ANMF chunks), if any.
    let frames = 0;
    let i = 12;
    while (i + 8 <= end) {
      const size = u32le(b, i + 4);
      if (ascii(b, i, 4) === "ANMF") frames += 1;
      i += 8 + size + (size & 1);
    }
    return { width, height, frames: Math.max(frames, 1) };
  }
  return null;
}

/**
 * Whether a WEBP stores its picture losslessly (a VP8L chunk) rather than as
 * lossy VP8. In an extended (VP8X) file the first picture chunk decides — for
 * an animation, the one inside its first frame.
 */
export function isLosslessWebp(b: Uint8Array): boolean {
  const first = ascii(b, 12, 4);
  if (first === "VP8L") return true;
  if (first !== "VP8X") return false;
  const end = Math.min(b.length, u32le(b, 4) + 8);
  let i = 12;
  while (i + 8 <= end) {
    const type = ascii(b, i, 4);
    const size = u32le(b, i + 4);
    if (type === "VP8L") return true;
    if (type === "VP8 ") return false;
    // An animation frame: 16 bytes of position and timing, then its own chunks.
    i += type === "ANMF" ? 8 + 16 : 8 + size + (size & 1);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Content that has no business in a flyer or a photo

/**
 * Markup or script that would turn a "picture" into something a browser could
 * run if it were ever served as a page. Long enough patterns that compressed
 * image data won't produce them by chance.
 */
const ACTIVE_MARKUP = /<script|<html[\s>]|<iframe|<!doctype\s+html|<\?php\s|javascript:/i;

/** PDF features that run code, launch programs or carry other files inside. */
const PDF_ACTIVE_NAMES = new Set(["JavaScript", "JS", "Launch", "EmbeddedFile", "EmbeddedFiles", "RichMedia", "XFA"]);

function latin1(bytes: Uint8Array) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
}

/**
 * The PDF's text with each stream body (from the line after `>> stream` up to
 * its `endstream`) cut out.
 *
 * Written as a single forward pass rather than one regex with a lazy
 * `[\s\S]*?endstream`: that regex rescans the rest of the file for every
 * `stream` that has no `endstream` after it, so a crafted 8MB file of
 * unclosed streams took many minutes. Here every search starts where the last
 * one stopped. Once a stream has no `endstream` after it, none of the later
 * ones can either, so the rest of the file is kept and checked as it is — the
 * same result the regex gave, and the strict choice: nothing is hidden by a
 * stream that never ends.
 */
function pdfTextOutsideStreams(text: string): string {
  const streamStart = />>\s*stream(?:\r\n|\n|\r)/g;
  const kept: string[] = [];
  let from = 0;
  for (;;) {
    streamStart.lastIndex = from;
    const start = streamStart.exec(text);
    if (!start) break;
    const bodyStart = start.index + start[0].length;
    const end = text.indexOf("endstream", bodyStart);
    if (end < 0) break;
    // Keep everything up to and including the line ending after `stream`, so
    // the next kept piece can't run into a name from this one.
    kept.push(text.slice(from, bodyStart));
    from = end + "endstream".length;
  }
  kept.push(text.slice(from));
  return kept.join("");
}

/**
 * The first active PDF feature named outside the file's streams, or null.
 * Stream bodies (fonts, pictures, page drawing — compressed binary) are
 * skipped so a chance byte pattern inside one can't trip this; names written
 * with #xx escapes are decoded first. Dictionaries packed inside compressed
 * object streams aren't looked into, so this is a filter, not a guarantee —
 * see docs/security-operations.md. Runs in time proportional to the file's size.
 */
export function findPdfActiveFeature(bytes: Uint8Array): string | null {
  const outsideStreams = pdfTextOutsideStreams(latin1(bytes));
  for (const match of outsideStreams.matchAll(/\/((?:[^\s/<>[\](){}%#]|#[0-9A-Fa-f]{2})+)/g)) {
    const name = match[1].replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    if (PDF_ACTIVE_NAMES.has(name)) return name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Removing metadata without an image library (the fallback when sharp is missing)

const EXIF_HEADER = "Exif\u0000\u0000";

/** EXIF orientation (1–8) from a TIFF structure starting at `tiff`, or null. */
function tiffOrientation(b: Uint8Array, tiff: number, end: number): number | null {
  if (tiff + 8 > end) return null;
  const order = ascii(b, tiff, 2);
  if (order !== "II" && order !== "MM") return null;
  const le = order === "II";
  const r16 = (i: number) => (le ? u16le(b, i) : u16be(b, i));
  const r32 = (i: number) => (le ? u32le(b, i) : u32be(b, i));
  const ifd = tiff + r32(tiff + 4);
  if (ifd + 2 > end) return null;
  const count = r16(ifd);
  for (let n = 0; n < count; n++) {
    const entry = ifd + 2 + n * 12;
    if (entry + 12 > end) return null;
    if (r16(entry) === 0x0112) {
      const value = r16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** The smallest TIFF structure that says only how the picture is turned: a header and one IFD entry. */
function orientationOnlyTiff(orientation: number) {
  return Uint8Array.from([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // "MM", 42, IFD at offset 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation, SHORT, 1 value
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ]);
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Whether a JPEG segment carries metadata rather than anything needed to draw the picture. */
function isJpegMetadataSegment(marker: number, segment: Uint8Array) {
  if (marker === 0xfe) return true; // comment
  if (marker === 0xe0) return ascii(segment, 4, 5) !== "JFIF\u0000"; // keep only the plain JFIF header
  if (marker === 0xe2) return ascii(segment, 4, 12) !== "ICC_PROFILE\u0000"; // keep the colour profile
  if (marker === 0xee) return ascii(segment, 4, 5) !== "Adobe"; // keep Adobe's colour-transform flag
  return marker >= 0xe1 && marker <= 0xef; // EXIF, XMP, IPTC and every other APPn
}

/**
 * The JPEG with every metadata segment (EXIF, XMP, IPTC, comments, maker
 * data) removed and nothing after the end of the picture, so an appended
 * "motion photo" video or second image goes too. If the photo was turned by
 * an EXIF orientation, a new EXIF block holding only that is written so it
 * still shows the right way up. Null if the file's structure doesn't parse.
 */
export function stripJpegMetadata(b: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let orientation: number | null = null;
  let afterHeader = 1; // where the new EXIF block goes: after SOI, or after a JFIF header
  let i = 2;
  for (;;) {
    if (i + 2 > b.length || b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd9) {
      parts.push(b.subarray(i, i + 2));
      break;
    }
    if (marker === 0xd8) return null;
    if (isStandaloneJpegMarker(marker)) {
      parts.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > b.length) return null;
    const end = i + 2 + u16be(b, i + 2);
    if (end < i + 4 || end > b.length) return null;
    const segment = b.subarray(i, end);
    if (isJpegMetadataSegment(marker, segment)) {
      if (marker === 0xe1 && orientation === null && ascii(segment, 4, 6) === EXIF_HEADER) {
        orientation = tiffOrientation(segment, 10, segment.length);
      }
    } else {
      parts.push(segment);
      if (marker === 0xe0 && parts.length === 2) afterHeader = 2;
    }
    i = end;
    if (marker === 0xda) {
      // Compressed picture data runs until the next marker that isn't a
      // stuffed byte (FF 00) or a restart marker (FF D0–D7).
      const start = i;
      while (i + 1 < b.length) {
        if (b[i] === 0xff) {
          const next = b[i + 1];
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            i += 2;
            continue;
          }
          if (next !== 0xff) break;
        }
        i += 1;
      }
      if (i + 1 >= b.length) return null; // ran out before the end-of-image marker
      parts.push(b.subarray(start, i));
    }
  }
  if (orientation !== null && orientation !== 1) {
    const tiff = orientationOnlyTiff(orientation);
    const length = 2 + EXIF_HEADER.length + tiff.length;
    const exif = concat([
      Uint8Array.from([0xff, 0xe1, length >> 8, length & 0xff]),
      Uint8Array.from(EXIF_HEADER, (c) => c.charCodeAt(0)),
      tiff,
    ]);
    parts.splice(afterHeader, 0, exif);
  }
  return concat(parts);
}

/** PNG chunks that only carry text, timestamps or EXIF. */
const PNG_METADATA_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

function pngChunk(type: string, data: Uint8Array) {
  const typeBytes = Uint8Array.from(type, (c) => c.charCodeAt(0));
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(concat([typeBytes, data])));
  return out;
}

/**
 * The PNG with its text, timestamp and EXIF chunks removed and nothing after
 * its end chunk. An EXIF orientation is kept the same way as for JPEGs. Null
 * if the chunk structure doesn't parse.
 */
export function stripPngMetadata(b: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let orientation: number | null = null;
  let i = 8;
  for (;;) {
    if (i + 12 > b.length) return null;
    const length = u32be(b, i);
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + length;
    if (length > 0x7fffffff || end > b.length) return null;
    if (PNG_METADATA_CHUNKS.has(type)) {
      if (type === "eXIf" && orientation === null) orientation = tiffOrientation(b, i + 8, i + 8 + length);
    } else {
      if (type === "IDAT" && orientation !== null && orientation !== 1) {
        parts.push(pngChunk("eXIf", orientationOnlyTiff(orientation)));
        orientation = 1;
      }
      parts.push(b.subarray(i, end));
    }
    i = end;
    if (type === "IEND") break;
  }
  return concat(parts);
}

// ---------------------------------------------------------------------------
// Checking and preparing an upload

function listOf(types: readonly UploadMediaType[]) {
  const names = types.map((type) => TYPE_NAMES[type]);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}`;
}

function article(name: string) {
  return /^[AEFHILMNORSX]/.test(name) ? `an ${name}` : `a ${name}`;
}

function normalizeClaimedType(raw: string): string {
  const type = raw.split(";")[0].trim().toLowerCase();
  return TYPE_ALIASES[type] ?? type;
}

function unreadable(label: string) {
  return `${label} couldn't be read — the file may be damaged. Open it, save or export it again, and try once more.`;
}

const SHARP_FORMATS: Record<ImageMediaType, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Decodes the image and saves it again in the same format: no metadata, no extra data, upright. */
async function reencodeImage(
  sharp: SharpConstructor,
  bytes: Uint8Array,
  type: ImageMediaType,
  info: ImageInfo,
  rules: UploadRules,
): Promise<Uint8Array> {
  const animated = info.frames > 1;
  try {
    const input = sharp(bytes, {
      animated,
      // Turn the pixels by the EXIF orientation, since the EXIF is about to go.
      autoOrient: true,
      // "error" rather than the stricter default "warning": many cameras write
      // JPEGs with harmless quirks that libjpeg only warns about.
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
    });
    const metadata = await input.metadata();
    // The header checks already agreed on the format, so a different answer
    // here is worth a line in the log (below), not just a refusal.
    if (metadata.format !== SHARP_FORMATS[type]) throw new Error(`sharp read the file as ${metadata.format ?? "nothing it knows"}`);

    let pipeline = input;
    if (rules.maxStoredSide) {
      pipeline = pipeline.resize({
        width: rules.maxStoredSide,
        height: rules.maxStoredSide,
        fit: "inside",
        withoutEnlargement: true,
      });
    }
    const timing = animated ? { delay: metadata.delay, loop: metadata.loop } : {};
    switch (type) {
      case "image/jpeg":
        pipeline = pipeline.jpeg({ quality: 88, mozjpeg: true });
        break;
      case "image/png":
        // A palette PNG (a logo, a flyer export) stays one, or it would grow several times over.
        pipeline = pipeline.png(metadata.isPalette ? { palette: true, dither: 0 } : {});
        break;
      case "image/webp":
        // A lossless WEBP (common for flyers exported with text) stays
        // lossless, or its lettering would blur, as a palette PNG stays one.
        pipeline = pipeline.webp(isLosslessWebp(bytes) ? { lossless: true, ...timing } : { quality: 88, ...timing });
        break;
      case "image/gif":
        pipeline = pipeline.gif(timing);
        break;
    }
    // Default output keeps no metadata: no EXIF, XMP, IPTC or comments.
    const output = new Uint8Array(await pipeline.toBuffer());
    if (sniffMediaType(output) !== type) throw new Error(`re-encoded ${type} came out as something else`);
    return output;
  } catch (error) {
    if (error instanceof UploadRejectedError) throw error;
    // Usually a file that passed the header checks but can't actually be
    // decoded. It could also be the image library failing on this server — a
    // missing codec, running out of memory — and then every upload would be
    // turned away as damaged, so say what happened in the logs: the error and
    // what kind of file it was, never anything from inside the file.
    console.error(
      `[upload] the image library couldn't re-save ${article(TYPE_NAMES[type])} ` +
        `(${info.width} × ${info.height} pixels, ${info.frames} frame${info.frames === 1 ? "" : "s"}, ${bytes.length} bytes); ` +
        `refused as unreadable`,
      error,
    );
    throw new UploadRejectedError(unreadable(rules.label));
  }
}

/**
 * Everything prepareUpload does once the file's bytes are in hand. Separate
 * so tests can run it with and without an image library (`sharp: null`).
 * Throws UploadRejectedError with an admin-readable message.
 */
export async function prepareUploadBytes(
  bytes: Uint8Array,
  claimedType: string,
  rules: UploadRules,
  sharp: SharpConstructor | null,
): Promise<PreparedUpload> {
  const maxBytes = rules.maxBytes ?? MAX_UPLOAD_BYTES;
  const allowedList = listOf(rules.allowed);

  if (bytes.length === 0) throw new UploadRejectedError(`${rules.label} is an empty file — choose it again.`);
  if (bytes.length > maxBytes) {
    throw new UploadRejectedError(`${rules.label} must be ${Math.floor(maxBytes / (1024 * 1024))}MB or smaller.`);
  }

  // What the file really is, from its own bytes, decides. The type the
  // browser reported only picks the wording of a refusal.
  const claimed = normalizeClaimedType(claimedType);
  const claimedAllowed = rules.allowed.includes(claimed as UploadMediaType);
  const actual = sniffMediaType(bytes);
  if (!actual) {
    switch (describeOtherFile(bytes)) {
      case "svg":
        throw new UploadRejectedError(`${rules.label} can't be an SVG drawing. Save it as a PNG or JPEG and try again.`);
      case "webpage":
        throw new UploadRejectedError(`That file is a web page, not ${article(allowedList)}.`);
      case "heic":
        throw new UploadRejectedError(`iPhone HEIC photos can't be used here. Share or export the photo as a JPEG and try again.`);
      case "avif":
        throw new UploadRejectedError(`AVIF images can't be used here. Save it as a JPEG or PNG and try again.`);
      default:
        throw new UploadRejectedError(
          claimedAllowed
            ? `${rules.label} must be ${article(allowedList)}, and this file isn't one, whatever its name says.`
            : `${rules.label} must be ${article(allowedList)}.`,
        );
    }
  }
  if (!rules.allowed.includes(actual)) {
    // A real file of a kind this upload doesn't take, such as a PDF chosen as an album cover.
    throw new UploadRejectedError(
      actual === claimed
        ? `${rules.label} must be ${article(allowedList)}.`
        : `${rules.label} must be ${article(allowedList)}, and this file is really ${article(TYPE_NAMES[actual])}, whatever its name says.`,
    );
  }
  // From here on the file is checked, and stored, as what it really is. A
  // different label (a PNG saved as .jpg) changes nothing: the stored type
  // and extension come from `actual`, so it's served as what it is.

  if (ACTIVE_MARKUP.test(latin1(bytes))) {
    throw new UploadRejectedError(
      `${rules.label} has web code hidden inside it, so it can't be used. Export or save the file again from the program that made it.`,
    );
  }

  if (actual === "application/pdf") {
    // Readers look for the end-of-file marker within the last 1KB.
    if (!latin1(bytes.subarray(Math.max(0, bytes.length - 1024))).includes("%%EOF")) {
      throw new UploadRejectedError(unreadable(rules.label));
    }
    const feature = findPdfActiveFeature(bytes);
    if (feature) {
      throw new UploadRejectedError(
        `This PDF contains scripts, attachments or interactive form code (${feature}), which the site doesn't accept. ` +
          `Print or export it to a new PDF, or save it as an image, and try again.`,
      );
    }
    return { bytes, contentType: actual, extension: EXTENSIONS[actual], metadataRemoved: false };
  }

  const info = readImageInfo(bytes, actual);
  if (!info) throw new UploadRejectedError(unreadable(rules.label));
  if (info.frames > MAX_ANIMATION_FRAMES) {
    throw new UploadRejectedError(
      `${rules.label} is an animation with ${info.frames} frames; the most allowed is ${MAX_ANIMATION_FRAMES}.`,
    );
  }
  if (
    info.width > MAX_IMAGE_SIDE ||
    info.height > MAX_IMAGE_SIDE ||
    info.width * info.height * info.frames > MAX_IMAGE_PIXELS
  ) {
    throw new UploadRejectedError(
      `${rules.label} is ${info.width.toLocaleString("en-US")} × ${info.height.toLocaleString("en-US")} pixels` +
        `${info.frames > 1 ? ` across ${info.frames} frames` : ""}, which is too large. ` +
        `The limit is ${MAX_IMAGE_SIDE.toLocaleString("en-US")} pixels on a side and ${MAX_IMAGE_PIXELS / 1_000_000} megapixels in all — resize it and try again.`,
    );
  }

  if (sharp) {
    const output = await reencodeImage(sharp, bytes, actual, info, rules);
    return { bytes: output, contentType: actual, extension: EXTENSIONS[actual], metadataRemoved: true };
  }

  // No image library: strip what can be stripped by rewriting the file.
  const stripped =
    actual === "image/jpeg" ? stripJpegMetadata(bytes) : actual === "image/png" ? stripPngMetadata(bytes) : null;
  if ((actual === "image/jpeg" || actual === "image/png") && !stripped) {
    throw new UploadRejectedError(unreadable(rules.label));
  }
  if (!stripped) {
    if (rules.requireMetadataRemoval) {
      throw new UploadRejectedError(
        `${TYPE_NAMES[actual]} photos can't be processed right now. Save the photo as a JPEG or PNG and try again.`,
      );
    }
    console.warn(`[upload] ${TYPE_NAMES[actual]} stored without removing its metadata: the image library isn't available`);
  }
  return {
    bytes: stripped ?? bytes,
    contentType: actual,
    extension: EXTENSIONS[actual],
    metadataRemoved: !!stripped,
  };
}

let sharpLoad: Promise<SharpConstructor | null> | undefined;

/**
 * sharp, loaded on first use. It's an optional dependency of Next.js, so it
 * may be missing from an install; then uploads still work, without the
 * re-encoding (see prepareUploadBytes), and the failure is logged once.
 */
export function loadSharp(): Promise<SharpConstructor | null> {
  sharpLoad ??= import("sharp").then(
    (mod) => (mod.default ?? mod) as SharpConstructor,
    (error) => {
      console.error("[upload] the image library (sharp) couldn't be loaded; images will be stored without re-encoding", error);
      return null;
    },
  );
  return sharpLoad;
}

/**
 * Checks an uploaded file against `rules` and returns what to store — the
 * cleaned image or the checked PDF — with the type and extension the file
 * really has. Throws UploadRejectedError with a message to show the person
 * uploading.
 */
export async function prepareUpload(file: File, rules: UploadRules): Promise<PreparedUpload> {
  const maxBytes = rules.maxBytes ?? MAX_UPLOAD_BYTES;
  // Size first, so an oversized file is never read into memory.
  if (file.size > maxBytes) {
    throw new UploadRejectedError(`${rules.label} must be ${Math.floor(maxBytes / (1024 * 1024))}MB or smaller.`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sharp = sniffMediaType(bytes) === "application/pdf" ? null : await loadSharp();
  return prepareUploadBytes(bytes, file.type, rules, sharp);
}
