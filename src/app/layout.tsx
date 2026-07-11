import type { Metadata } from "next";
import { Baloo_2, Poppins } from "next/font/google";
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
    "Pack 376 is a Cub Scout pack in Brooklyn, NY chartered by Our Lady of Grace. All families welcome — all kids, kindergarten through 5th grade. Real adventures, lifelong skills, and a whole lot of fun — boardwalk style.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${baloo2.variable} ${poppins.variable}`}>
      <body>{children}</body>
    </html>
  );
}
