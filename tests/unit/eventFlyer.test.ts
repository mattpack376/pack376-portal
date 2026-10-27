/*
 * What EventFlyer and FlyerLink actually render, server-side. next/image gets
 * the real `images` settings from next.config.ts (through the context it
 * falls back to when no bundler inlined them), so an image URL flyerDisplay
 * calls optimizable but next.config.ts doesn't allow would throw here, the
 * same way it does in `next dev`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageConfigContext } from "next/dist/shared/lib/image-config-context.shared-runtime";
import { imageConfigDefault, type ImageConfigComplete } from "next/dist/shared/lib/image-config";
import nextConfig from "../../next.config";
import EventFlyer, { FlyerLink } from "@/components/EventFlyer";

const STORE = "https://jyclzu7uphezevn7.public.blob.vercel-storage.com";

function render(element: ReactElement) {
  const config = { ...imageConfigDefault, ...nextConfig.images } as ImageConfigComplete;
  return renderToStaticMarkup(createElement(ImageConfigContext.Provider, { value: config }, element));
}

describe("EventFlyer", () => {
  it("renders a PDF as a keyboard-reachable link, never through the image optimizer", () => {
    const url = `${STORE}/trip-flyers/abc.PDF?download=1`;
    const html = render(createElement(EventFlyer, { flyerUrl: url, title: "Brooklyn Cyclones Overnight", linkClassName: "btn btn-primary" }));
    assert.match(html, new RegExp(`<a href="${url.replace(/[.?]/g, "\\$&")}" target="_blank" rel="noopener noreferrer" class="btn btn-primary"`));
    assert.match(html, /View Flyer \(PDF\)/);
    assert.match(html, /for Brooklyn Cyclones Overnight, opens in a new tab/);
    assert.doesNotMatch(html, /<img|_next\/image|<button|<dialog/);
  });

  it("renders an uploaded image as an enlargeable picture with a named dialog", () => {
    const url = `${STORE}/trip-flyers/abc.png`;
    const html = render(
      createElement(EventFlyer, {
        flyerUrl: url,
        title: "Camp Conron",
        size: { width: 360, height: 465, enlargedWidth: 680, enlargedHeight: 880 },
      }),
    );
    assert.match(html, /<img[^>]+alt="Camp Conron flyer"/);
    assert.ok(html.includes(`/_next/image?url=${encodeURIComponent(url)}`));
    assert.match(html, /<button[^>]+aria-label="Enlarge: Camp Conron flyer"[^>]+aria-haspopup="dialog"/);
    assert.match(html, /<dialog[^>]+aria-label="Camp Conron flyer"/);
    assert.match(html, /width="360"/);
    assert.doesNotMatch(html, /<a /);
  });

  it("keeps the event card's original size by default", () => {
    const html = render(createElement(EventFlyer, { flyerUrl: `${STORE}/event-flyers/abc.jpg`, title: "Pack Picnic" }));
    assert.match(html, /<img[^>]+width="180"[^>]+height="230"/);
  });

  it("links to an image the optimizer wouldn't take instead of breaking", () => {
    const html = render(createElement(EventFlyer, { flyerUrl: "https://example.org/flyer.png", title: "Pack Picnic" }));
    assert.match(html, /<a href="https:\/\/example\.org\/flyer\.png"/);
    assert.match(html, /View Flyer/);
    assert.doesNotMatch(html, /<img|_next\/image/);
  });

  it("renders nothing without a usable URL", () => {
    for (const flyerUrl of [null, "", "javascript:alert(1)//.pdf"]) {
      assert.equal(render(createElement(EventFlyer, { flyerUrl, title: "x" })), "", String(flyerUrl));
    }
  });
});

describe("FlyerLink", () => {
  it("says what the link opens, for the admin and view-only pages", () => {
    const pdf = render(createElement(FlyerLink, { flyerUrl: `${STORE}/trip-flyers/a.pdf`, title: "Cyclones", text: "View current flyer" }));
    assert.match(pdf, /View current flyer \(PDF\)/);
    const image = render(createElement(FlyerLink, { flyerUrl: `${STORE}/trip-flyers/a.webp`, title: "Cyclones", text: "View flyer" }));
    assert.match(image, /View flyer \(image\)/);
    assert.match(image, /for Cyclones, opens in a new tab/);
    assert.doesNotMatch(image, /<img/);
  });
});
