import Link from "next/link";
import { getLeaderScoutingYears, getAdultLeaderMeetingOverview } from "@/lib/adultLeaderAttendanceData";
import { formatMeetingDate } from "@/lib/attendanceSchedule";
import { requireLeaderAttendanceSession } from "@/lib/authorize";
import AttendanceSubNav from "@/components/AttendanceSubNav";
import FileExportButton from "@/components/FileExportButton";
import MeetingTimeline from "@/components/MeetingTimeline";
import { getAttendanceLockRule } from "@/lib/attendanceLockSetting";

export default async function AdminLeaderAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  // Checked here as well as in the layout: a layout isn't re-run on every
  // navigation and doesn't stop this page rendering, so the page guards its own data.
  const session = await requireLeaderAttendanceSession();
  const years = await getLeaderScoutingYears();
  const { year: requestedYear } = await searchParams;
  const scoutingYear = requestedYear && years.includes(requestedYear) ? requestedYear : years[0];
  const canManage = session.role === "ADMIN";

  const { activeCount, dates } = await getAdultLeaderMeetingOverview(scoutingYear);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Attendance</div>
          <h2>Leaders &amp; Committee</h2>
          <p>Same meeting calendar as the scouts (Fridays plus Scout Sundays) — a date marked No Meeting is cancelled here too.</p>
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

      <AttendanceSubNav active="leaders" year={scoutingYear} />

      <div style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <FileExportButton
          className="btn btn-quiet"
          href={`/api/attendance/export/leaders?scoutingYear=${encodeURIComponent(scoutingYear)}`}
          label={`⬇ Export ${scoutingYear} CSV`}
        />
        {canManage && (
          <Link className="btn btn-quiet" href="/portal/admin/attendance/leaders/manage">
            Manage List
          </Link>
        )}
      </div>

      {activeCount === 0 && (
        <div className="info-card" style={{ marginBottom: 16 }}>
          Nobody is on the leader &amp; committee list yet.
          {canManage ? " Add people from Manage List." : " An admin can add people to it."}
        </div>
      )}

      <MeetingTimeline
        dates={dates}
        lockRule={await getAttendanceLockRule()}
        renderRow={(m) =>
          m.status === "NO_MEETING" ? (
            <Link className="meeting-row no-meeting" href={`/portal/admin/attendance/leaders/${m.id}`} key={m.id}>
              <span className="meeting-date-label">{formatMeetingDate(m.date, m.eventLabel)}</span>
              <span className="badge-pill badge-cancelled">No Meeting</span>
            </Link>
          ) : (
            <Link className="meeting-row" href={`/portal/admin/attendance/leaders/${m.id}`} key={m.id}>
              <span className="meeting-date-label">{formatMeetingDate(m.date, m.eventLabel)}</span>
              <span className="meeting-summary">
                {m.listedCount === 0 ? "Nobody on the list" : `${m.presentCount}/${m.listedCount} present`}
              </span>
            </Link>
          )
        }
      />
    </>
  );
}
