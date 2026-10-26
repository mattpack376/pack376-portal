import { requireTripPageSession } from "@/lib/authorize";
import TripAdminView from "@/components/TripAdminView";
import { CAMP_CONRON_SITE } from "@/lib/tripSites";

export default async function AdminCampConronPage({
  searchParams,
}: {
  searchParams: Promise<{ affiliation?: string }>;
}) {
  const session = await requireTripPageSession();
  const { affiliation } = await searchParams;
  return <TripAdminView site={CAMP_CONRON_SITE} role={session.role} affiliationParam={affiliation} />;
}
