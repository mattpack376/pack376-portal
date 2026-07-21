import type { Metadata, Viewport } from "next";
import { Baloo_2, Poppins } from "next/font/google";
import FilteredAnalytics from "@/components/FilteredAnalytics";
import "./globals.css";

const baloo2 = Baloo_2({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "700", "800"],
});

const poppins = Poppins({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Pack 376 — Cub Scouts, Brooklyn NY",
  description:
    "Pack 376 is a Cub Scout pack in Brooklyn, NY chartered by Our Lady of Grace. All families welcome — boys and girls, kindergarten through 5th grade. Real adventures, lifelong skills, and a whole lot of fun — boardwalk style.",
  appleWebApp: {
    capable: true,
    title: "Pack 376 Portal",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#003f87",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${baloo2.variable} ${poppins.variable}`}>
      <head>
        {/* Next's appleWebApp metadata only emits the unprefixed
            mobile-web-app-capable tag in this version — older iOS Safari
            (pre-16.4) needs the apple- prefixed one too for standalone mode. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body>
        {children}
        <FilteredAnalytics />
      </body>
    </html>
  );
}
