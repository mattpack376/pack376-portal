import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pack 376 Portal",
    short_name: "Pack 376",
    description: "Pack 376 Cub Scouts — Brooklyn, NY",
    start_url: "/portal",
    display: "standalone",
    background_color: "#fff8ea",
    theme_color: "#003f87",
    icons: [
      { src: "/cub-scout-emblem.png", sizes: "700x700", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
