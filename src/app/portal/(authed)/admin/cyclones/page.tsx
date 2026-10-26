import { requireTripPageSession } from "@/lib/authorize";
import TripAdminView from "@/components/TripAdminView";
import { CYCLONES_SITE } from "@/lib/tripSites";

export default async function AdminCyclonesPage({
  searchParams,
}: {
  searchParams: Promise<{ affiliation?: string }>;
}) {
  const session = await requireTripPageSession();
  const { affiliation } = await searchParams;
  return <TripAdminView site={CYCLONES_SITE} role={session.role} affiliationParam={affiliation} />;
}
