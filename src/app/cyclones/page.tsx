import type { Metadata } from "next";
import TripPublicView from "@/components/TripPublicView";
import { CYCLONES_SITE } from "@/lib/tripSites";

export const metadata: Metadata = {
  title: "Brooklyn Cyclones Overnight — Pack 376",
  description:
    "Register for the Brooklyn Cyclones Overnight at Maimonides Park — a joint Pack 376 / Troop 376 event on Friday, April 23, 2027.",
};

// Has to be set here, not inside TripPublicView: Next reads route segment
// config from the page file itself. See TripPublicView for why this page can't
// be prerendered at build time.
export const dynamic = "force-dynamic";

export default function CyclonesPage() {
  return <TripPublicView site={CYCLONES_SITE} />;
}
