/*
 * Review finding F10: the upload form takes PDF flyers, but the public trip
 * page always handed the flyer to next/image. This calls the real page
 * components for both trip sites — the public page, the Admin page and the
 * Troop's view-only page — with an image and a PDF flyer stored, finds the
 * flyer element each one produced, and renders it with next.config.ts's real
 * image settings.
 *
 * Async server components can't be rendered whole outside Next, so the pages
 * are called as functions and their element trees searched; the flyer
 * elements themselves are ordinary components and are rendered for real.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageConfigContext } from "next/dist/shared/lib/image-config-context.shared-runtime";
import { imageConfigDefault, type ImageConfigComplete } from "next/dist/shared/lib/image-config";
import nextConfig from "../../next.config";
import { withTestDatabase } from "../support/db";
import { freshTrip } from "./tripHelpers";

const db = withTestDatabase("trip_flyer_pages");
let EventFlyer: typeof import("@/components/EventFlyer").default;
let FlyerLink: typeof import("@/components/EventFlyer").FlyerLink;
let TripPublicView: typeof import("@/components/TripPublicView").default;
let TripAdminView: typeof import("@/components/TripAdminView").default;
let TripViewerView: typeof import("@/components/TripViewerView").default;
let sites: typeof import("@/lib/tripSites");

before(async () => {
  await db.ready;
  ({ default: EventFlyer, FlyerLink } = await import("@/components/EventFlyer"));
  ({ default: TripPublicView } = await import("@/components/TripPublicView"));
  ({ default: TripAdminView } = await import("@/components/TripAdminView"));
  ({ default: TripViewerView } = await import("@/components/TripViewerView"));
  sites = await import("@/lib/tripSites");
});

const STORE = "https://jyclzu7uphezevn7.public.blob.vercel-storage.com";
const PDF = `${STORE}/trip-flyers/flyer.pdf?download=1`;
const IMAGE = `${STORE}/trip-flyers/flyer.png`;

/** Every element of a given component type anywhere in an (unrendered) element tree. */
function findElements(node: ReactNode, type: unknown, found: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) findElements(child, type, found);
  } else if (isValidElement(node)) {
    if (node.type === type) found.push(node);
    const props = node.props as Record<string, unknown>;
    for (const value of Object.values(props)) {
      if (Array.isArray(value) || isValidElement(value)) findElements(value as ReactNode, type, found);
    }
  }
  return found;
}

function render(element: ReactElement) {
  const config = { ...imageConfigDefault, ...nextConfig.images } as ImageConfigComplete;
  return renderToStaticMarkup(createElement(ImageConfigContext.Provider, { value: config }, element));
}

for (const siteName of ["CAMP_CONRON_SITE", "CYCLONES_SITE"] as const) {
  describe(`${siteName === "CYCLONES_SITE" ? "Cyclones" : "Camp Conron"} flyer`, () => {
    const site = () => sites[siteName];

    it("public page: a PDF is a link, an image is the enlargeable picture", async () => {
      await freshTrip(db.prisma, { slug: site().slug, priceTbd: false, flyerUrl: PDF });
      let [flyer] = findElements(await TripPublicView({ site: site() }), EventFlyer);
      assert.ok(flyer, "the public page renders the flyer through EventFlyer");
      let html = render(flyer);
      assert.match(html, /<a href="[^"]+flyer\.pdf\?download=1"[^>]*class="btn btn-primary"/);
      assert.match(html, /View Flyer \(PDF\)/);
      assert.doesNotMatch(html, /<img|_next\/image/);

      await freshTrip(db.prisma, { slug: site().slug, priceTbd: false, flyerUrl: IMAGE });
      [flyer] = findElements(await TripPublicView({ site: site() }), EventFlyer);
      html = render(flyer);
      assert.ok(html.includes(`/_next/image?url=${encodeURIComponent(IMAGE)}`));
      assert.match(html, /<img[^>]+width="360"[^>]+height="465"/, "the public page's large size");
      assert.match(html, /<dialog[^>]+aria-label="[^"]+ flyer"/);
    });

    it("Admin and view-only pages: a link that says it's a PDF or an image", async () => {
      for (const [flyerUrl, kind] of [
        [PDF, "PDF"],
        [IMAGE, "image"],
      ] as const) {
        await freshTrip(db.prisma, { slug: site().slug, priceTbd: false, flyerUrl });

        const adminTree = await TripAdminView({ site: site(), role: "ADMIN", affiliationParam: undefined });
        const [adminLink] = findElements(adminTree, FlyerLink);
        assert.ok(adminLink, "the Admin page links to the flyer");
        assert.match(render(adminLink), new RegExp(`View current flyer \\(${kind}\\)`));

        const viewer = findElements(
          await TripAdminView({ site: site(), role: "TRIP_VIEWER", affiliationParam: undefined }),
          TripViewerView,
        )[0];
        assert.ok(viewer, "a Troop login gets the view-only page");
        const [viewerLink] = findElements(TripViewerView(viewer.props as Parameters<typeof TripViewerView>[0]), FlyerLink);
        const html = render(viewerLink);
        assert.match(html, new RegExp(`View flyer \\(${kind}\\)`));
        assert.doesNotMatch(html, /<img|_next\/image/);
      }
    });
  });
}
