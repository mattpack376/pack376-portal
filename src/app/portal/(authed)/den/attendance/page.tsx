import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/authorize";
import { getDenAttendanceOverview } from "@/lib/attendanceData";
import { formatMeetingDate } from "@/lib/attendanceSchedule";
import { denDisplayName } from "@/lib/rankConfig";

export default async function DenAttendancePage() {
  const session = await requireSession();
  if (session.role !== "DEN" || !session.denId) {
    redirect("/portal/admin/attendance");
  }

  const data = await getDenAttendanceOverview(session.denId);
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

      <div style={{ marginBottom: 16 }}>
        <a
          className="btn btn-outline"
          style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
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
            <Link className="meeting-row" href={`/portal/den/attendance/${m.id}`} key={m.id}>
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
