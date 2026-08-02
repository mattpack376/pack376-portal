import type { MetadataRoute } from "next";
import { getPublicBaseUrl } from "@/lib/appUrl";

const PUBLIC_ROUTES: { path: string; changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>; priority: number }[] = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/intro-to-scouting", changeFrequency: "monthly", priority: 0.8 },
  { path: "/contact", changeFrequency: "yearly", priority: 0.7 },
  { path: "/activities", changeFrequency: "monthly", priority: 0.6 },
  { path: "/rank-requirements", changeFrequency: "monthly", priority: 0.6 },
  { path: "/volunteer", changeFrequency: "monthly", priority: 0.6 },
  { path: "/parent-resources", changeFrequency: "monthly", priority: 0.5 },
  { path: "/den-leaders-corner", changeFrequency: "monthly", priority: 0.5 },
  { path: "/gallery", changeFrequency: "monthly", priority: 0.5 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getPublicBaseUrl();
  const lastModified = new Date();

  return PUBLIC_ROUTES.map((route) => ({
    url: `${baseUrl}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
