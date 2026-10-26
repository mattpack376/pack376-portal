import type { Metadata } from "next";
import TripPublicView from "@/components/TripPublicView";
import { CAMP_CONRON_SITE } from "@/lib/tripSites";

export const metadata: Metadata = {
  title: "Camp Conron Halloween Weekend — Pack 376",
  description:
    "Register for the Camp Conron Halloween Weekend — a joint Pack 376 / Troop 376 camping trip, October 9–12 in Holmes, NY.",
};

// Has to be set here, not inside TripPublicView: Next reads route segment
// config from the page file itself. See TripPublicView for why this page can't
// be prerendered at build time.
export const dynamic = "force-dynamic";

export default function CampConronPage() {
  return <TripPublicView site={CAMP_CONRON_SITE} />;
}
