import type { MetadataRoute } from "next";
import { getPublicBaseUrl } from "@/lib/appUrl";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getPublicBaseUrl();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /portal is the authenticated admin/parent app (session-gated regardless);
      // /consent/* is per-family photo-consent links; /api is not page content;
      // /album-photos/* is event photos of children, kept out of image search.
      disallow: ["/portal", "/consent", "/api", "/album-photos"],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
