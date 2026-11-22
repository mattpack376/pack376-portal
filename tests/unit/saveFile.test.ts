import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { bareType, shareableFile, shareFileOnly, sharesOnTap } from "@/lib/saveFile";

/*
 * The phone share path every export uses (FileExportButton, the calendar
 * card, receipts). Node has no window or share sheet, so the browser pieces
 * are stand-ins: a matchMedia that answers the pointer query, a navigator
 * with canShare/share, and a document that records saved downloads.
 */

type Shared = { keys: string[]; files: File[] };
let shared: Shared[];
let saved: string[];
let shareError: DOMException | null;
let canShareTypes: string[];
let coarse: boolean;
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

beforeEach(() => {
  shared = [];
  saved = [];
  shareError = null;
  canShareTypes = ["application/pdf", "text/csv", "image/png"];
  coarse = true;
  const fakeNavigator = {
    canShare: (data: { files?: File[] }) => !!data.files?.length && data.files.every((f) => canShareTypes.includes(f.type)),
    share: async (data: Record<string, unknown>) => {
      if (shareError) throw shareError;
      shared.push({ keys: Object.keys(data), files: (data.files as File[]) ?? [] });
    },
  };
  Object.defineProperty(globalThis, "navigator", { value: fakeNavigator, configurable: true });
  Object.assign(globalThis, {
    window: { matchMedia: (q: string) => ({ matches: /pointer:\s*coarse/.test(q) ? coarse : false }) },
    document: {
      createElement: () => {
        const link = { href: "", download: "", click: () => saved.push(link.download), remove: () => {} };
        return link;
      },
      body: { appendChild: () => {} },
    },
  });
});

afterEach(() => {
  if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
});

describe("bareType / shareableFile", () => {
  it("drops parameters, which Android's share list doesn't accept", () => {
    assert.equal(bareType("text/csv; charset=utf-8"), "text/csv");
    assert.equal(bareType("Application/PDF"), "application/pdf");
    assert.equal(bareType(""), "");
  });

  it("keeps the export's name and gives the file a bare type", () => {
    const file = shareableFile(new Blob(["a,b"], { type: "text/csv;charset=utf-8" }), "pack376-dues-2026-2027.csv");
    assert.equal(file.name, "pack376-dues-2026-2027.csv");
    assert.equal(file.type, "text/csv");
    assert.equal(file.size, 3);
  });
});

describe("sharesOnTap", () => {
  it("is true on a phone for PDFs, CSVs and pictures, even with a charset", () => {
    assert.equal(sharesOnTap("application/pdf"), true);
    assert.equal(sharesOnTap("text/csv; charset=utf-8"), true);
    assert.equal(sharesOnTap("image/png"), true);
  });

  it("is false for a type the phone won't share", () => {
    assert.equal(sharesOnTap("application/zip"), false);
  });

  it("is false with a mouse, so computers download", () => {
    coarse = false;
    assert.equal(sharesOnTap("application/pdf"), false);
  });

  it("is false where the browser has no file sharing (in-app browsers, older phones)", () => {
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    assert.equal(sharesOnTap("application/pdf"), false);
  });
});

describe("shareFileOnly", () => {
  const file = () => new File(["%PDF"], "pack376-receipt.pdf", { type: "application/pdf" });

  it("shares the file and nothing else (no title, text or link)", async () => {
    assert.equal(await shareFileOnly(file()), "done");
    assert.deepEqual(shared.map((s) => s.keys), [["files"]]);
    assert.equal(shared[0].files[0].name, "pack376-receipt.pdf");
    assert.deepEqual(saved, []);
  });

  it("asks for another tap when the phone says the tap is too old", async () => {
    shareError = new DOMException("needs a gesture", "NotAllowedError");
    assert.equal(await shareFileOnly(file()), "needs-tap");
    assert.deepEqual(saved, []);
  });

  it("does nothing more when the person closes the sheet", async () => {
    shareError = new DOMException("cancelled", "AbortError");
    assert.equal(await shareFileOnly(file()), "done");
    assert.deepEqual(saved, []);
  });

  it("saves the file instead when the sheet can't take it", async () => {
    shareError = new DOMException("nope", "DataError");
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = () => "blob:test";
    try {
      assert.equal(await shareFileOnly(file()), "done");
    } finally {
      URL.createObjectURL = realCreate;
    }
    assert.deepEqual(saved, ["pack376-receipt.pdf"]);
  });
});
