import Link from "next/link";
import { getAdminScoutingYears, getAdminMeetingOverview } from "@/lib/attendanceData";
import { formatMeetingDate } from "@/lib/attendanceSchedule";
import { getSession } from "@/lib/auth";
import { canAccessLeaderAttendance } from "@/lib/authorize";
import AttendanceSubNav from "@/components/AttendanceSubNav";

export default async function AdminAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const [years, session] = await Promise.all([getAdminScoutingYears(), getSession()]);
  const { year: requestedYear } = await searchParams;
  const scoutingYear = requestedYear && years.includes(requestedYear) ? requestedYear : years[0];
  // Committee Members take scout attendance but not leader attendance, so
  // they get no tab to switch to.
  const showLeaderTab = !!session && canAccessLeaderAttendance(session);

  if (!scoutingYear) {
    // Leader attendance doesn't need a den, so keep it reachable from here.
    return (
      <>
        {showLeaderTab && <AttendanceSubNav active="scouts" />}
        <div className="info-card">No dens exist yet — create one from the Dashboard first.</div>
      </>
    );
  }

  const { totalScouts, dates } = await getAdminMeetingOverview(scoutingYear);

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
        <a className="btn btn-quiet" href={`/api/attendance/export/pack?scoutingYear=${encodeURIComponent(scoutingYear)}`}>
          ⬇ Export {scoutingYear} CSV
        </a>
      </div>

      <div className="meeting-list">
        {dates.map((m) =>
          m.status === "NO_MEETING" ? (
            <Link className="meeting-row no-meeting" href={`/portal/admin/attendance/${m.id}`} key={m.id}>
              <span className="meeting-date-label">{formatMeetingDate(m.date)}</span>
              <span className="badge-pill badge-cancelled">No Meeting</span>
            </Link>
          ) : (
            <Link className="meeting-row" href={`/portal/admin/attendance/${m.id}`} key={m.id}>
              <span className="meeting-date-label">{formatMeetingDate(m.date)}</span>
              <span className="meeting-summary">
                {totalScouts === 0 ? "No scouts yet" : `${m.presentCount}/${totalScouts} present`}
              </span>
            </Link>
          )
        )}
      </div>
    </>
  );
}
