import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { flyerDisplay } from "@/lib/flyerDisplay";

const STORE = "https://jyclzu7uphezevn7.public.blob.vercel-storage.com";

describe("flyerDisplay", () => {
  it("shows the pack's uploaded images as images", () => {
    for (const extension of ["jpg", "jpeg", "png", "webp", "gif"]) {
      assert.equal(flyerDisplay(`${STORE}/trip-flyers/abc.${extension}`), "image", extension);
      assert.equal(flyerDisplay(`${STORE}/event-flyers/abc.${extension}`), "image", extension);
    }
    assert.equal(flyerDisplay(`${STORE}/trip-flyers/abc.PNG`), "image", "extension case doesn't matter");
    assert.equal(flyerDisplay(`${STORE}/trip-flyers/abc.png?v=2`), "image", "a query string doesn't matter");
    assert.equal(flyerDisplay(`${STORE}/trip-flyers/abc.png#top`), "image");
  });

  it("recognizes a PDF by its path, whatever follows it or how it's capitalized", () => {
    assert.equal(flyerDisplay(`${STORE}/trip-flyers/abc.pdf`), "pdf");
    assert.equal(flyerDisplay(`${STORE}/trip-flyers/abc.PDF`), "pdf");
    assert.equal(flyerDisplay(`${STORE}/event-flyers/abc.Pdf`), "pdf");
    // A whole-URL ".pdf" suffix check got these wrong and sent the PDF to next/image.
    assert.equal(flyerDisplay(`${STORE}/trip-flyers/abc.pdf?download=1`), "pdf");
    assert.equal(flyerDisplay(`${STORE}/trip-flyers/abc.pdf#page=2`), "pdf");
  });

  it("isn't fooled by '.pdf' or an image extension outside the path", () => {
    assert.equal(flyerDisplay(`${STORE}/trip-flyers/abc.png?name=flyer.pdf`), "image");
    assert.equal(flyerDisplay(`${STORE}/trip-flyers/abc.png#.pdf`), "image");
    assert.equal(flyerDisplay(`${STORE}/trip-flyers/abc.pdf?as=.png`), "pdf");
    assert.equal(flyerDisplay(`${STORE}/trip-flyers/abc.pdf.png`), "image");
    assert.equal(flyerDisplay(`${STORE}/trip-flyers/abc.png.pdf`), "pdf");
  });

  it("links to PDFs on other hosts, but never sends their images through the optimizer", () => {
    assert.equal(flyerDisplay("https://example.org/flyers/cyclones.pdf"), "pdf");
    assert.equal(flyerDisplay("http://example.org/flyers/cyclones.PDF?x=1"), "pdf");
    // next.config.ts only lets the optimizer fetch the pack's own store, in
    // the flyer folders, over https — anything else would be a broken image.
    assert.equal(flyerDisplay("https://example.org/flyers/cyclones.png"), "link");
    assert.equal(flyerDisplay("https://other-store.public.blob.vercel-storage.com/trip-flyers/abc.png"), "link");
    assert.equal(flyerDisplay(`${STORE}/album-covers/abc.png`), "link", "not a flyer folder");
    assert.equal(flyerDisplay(`${STORE}/TRIP-FLYERS/abc.png`), "link", "folders match exactly, as in next.config.ts");
    assert.equal(flyerDisplay(`${STORE}/trip-flyers/../album-covers/abc.png`), "link", "a normalized path is what counts");
    assert.equal(flyerDisplay(`http://jyclzu7uphezevn7.public.blob.vercel-storage.com/trip-flyers/abc.png`), "link");
  });

  it("links to anything else that isn't clearly an image", () => {
    assert.equal(flyerDisplay(`${STORE}/trip-flyers/abc`), "link");
    assert.equal(flyerDisplay(`${STORE}/trip-flyers/abc.svg`), "link");
    assert.equal(flyerDisplay(`${STORE}/trip-flyers/abc.docx`), "link");
  });

  it("shows nothing for no URL or one that isn't http(s)", () => {
    for (const url of [null, undefined, "", "not a url", "/trip-flyers/abc.pdf", "javascript:alert(1)//x.pdf", "data:application/pdf;base64,AA=="]) {
      assert.equal(flyerDisplay(url), null, String(url));
    }
  });
});
