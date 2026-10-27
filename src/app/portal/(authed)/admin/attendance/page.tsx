import Link from "next/link";
import { getAdminScoutingYears, getAdminMeetingOverview } from "@/lib/attendanceData";
import { formatMeetingDate } from "@/lib/attendanceSchedule";
import { canAccessLeaderAttendance, requireAttendanceSession } from "@/lib/authorize";
import AttendanceSubNav from "@/components/AttendanceSubNav";
import FileExportButton from "@/components/FileExportButton";
import MeetingTimeline from "@/components/MeetingTimeline";

export default async function AdminAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  // Checked here as well as in the layout: a layout isn't re-run on every
  // navigation and doesn't stop this page rendering, so the page guards its own data.
  const session = await requireAttendanceSession();
  const years = await getAdminScoutingYears();
  const { year: requestedYear } = await searchParams;
  const scoutingYear = requestedYear && years.includes(requestedYear) ? requestedYear : years[0];
  // Committee Members take scout attendance but not leader attendance, so
  // they get no tab to switch to.
  const showLeaderTab = canAccessLeaderAttendance(session);

  if (!scoutingYear) {
    // Leader attendance doesn't need a den, so keep it reachable from here.
    return (
      <>
        {showLeaderTab && <AttendanceSubNav active="scouts" />}
        <div className="info-card">No dens exist yet — create one from the Dashboard first.</div>
      </>
    );
  }

  const { dates } = await getAdminMeetingOverview(scoutingYear);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Attendance</div>
          <h2>Pack-Wide Meeting Calendar</h2>
        </div>
        <form style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label htmlFor="year">Scouting Year</label>
            <select id="year" name="year" defaultValue={scoutingYear}>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-quiet">
            Go
          </button>
        </form>
      </div>

      {showLeaderTab && <AttendanceSubNav active="scouts" year={scoutingYear} />}

      <div style={{ marginBottom: 16 }}>
        <FileExportButton
          className="btn btn-quiet"
          href={`/api/attendance/export/pack?scoutingYear=${encodeURIComponent(scoutingYear)}`}
          label={`⬇ Export ${scoutingYear} CSV`}
        />
      </div>

      <MeetingTimeline
        dates={dates}
        renderRow={(m) =>
          m.status === "NO_MEETING" ? (
            <Link className="meeting-row no-meeting" href={`/portal/admin/attendance/${m.id}`} key={m.id}>
              <span className="meeting-date-label">{formatMeetingDate(m.date, m.eventLabel)}</span>
              <span className="badge-pill badge-cancelled">No Meeting</span>
            </Link>
          ) : (
            <Link className="meeting-row" href={`/portal/admin/attendance/${m.id}`} key={m.id}>
              <span className="meeting-date-label">{formatMeetingDate(m.date, m.eventLabel)}</span>
              <span className="meeting-summary">
                {m.listedCount === 0 ? "No scouts yet" : `${m.presentCount}/${m.listedCount} present`}
              </span>
            </Link>
          )
        }
      />
    </>
  );
}
