import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSession, homeForRole } from "@/lib/authorize";
import { getDenAttendanceOverview } from "@/lib/attendanceData";
import { formatMeetingDate } from "@/lib/attendanceSchedule";
import { denDisplayName } from "@/lib/rankConfig";
import DenSwitcher from "@/components/DenSwitcher";

export default async function DenAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ denId?: string }>;
}) {
  const session = await requireSession();
  if (session.role !== "DEN") {
    redirect(homeForRole(session.role));
  }
  if (session.denIds.length === 0) {
    return (
      <div className="info-card">
        Your account isn&apos;t linked to a den yet. Contact an admin to get assigned.
      </div>
    );
  }

  const { denId: requestedDenId } = await searchParams;
  const denId = requestedDenId && session.denIds.includes(requestedDenId) ? requestedDenId : session.denIds[0];

  const data = await getDenAttendanceOverview(denId);
  if (!data) {
    return <div className="info-card">Your den could not be found. Contact an admin.</div>;
  }

  const { den, totalScouts, dates } = data;

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Attendance</div>
        <h2>{denDisplayName(den.rank, den.scoutingYear, den.label)}</h2>
        <p>Weekly Friday meetings, September through June. Tap a date to take attendance.</p>
      </div>

      <DenSwitcher denIds={session.denIds} currentDenId={denId} basePath="/portal/den/attendance" />

      <div style={{ marginBottom: 16 }}>
        <a
          className="btn btn-quiet"
          href={`/api/attendance/export/den/${den.id}`}
        >
          ⬇ Export CSV
        </a>
      </div>

      <div className="meeting-list">
        {dates.map((m) =>
          m.status === "NO_MEETING" ? (
            <div className="meeting-row no-meeting" key={m.id}>
              <span className="meeting-date-label">{formatMeetingDate(m.date)}</span>
              <span className="badge-pill badge-cancelled">No Meeting</span>
            </div>
          ) : (
            <Link className="meeting-row" href={`/portal/den/attendance/${m.id}?denId=${denId}`} key={m.id}>
              <span className="meeting-date-label">{formatMeetingDate(m.date)}</span>
              <span className="meeting-summary">
                {totalScouts === 0
                  ? "No scouts on roster"
                  : `${m.presentCount}/${totalScouts} present`}
              </span>
            </Link>
          )
        )}
      </div>
    </>
  );
}
