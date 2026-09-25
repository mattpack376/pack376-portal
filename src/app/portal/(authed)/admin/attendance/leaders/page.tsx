import Link from "next/link";
import { getLeaderScoutingYears, getAdultLeaderMeetingOverview } from "@/lib/adultLeaderAttendanceData";
import { formatMeetingDate } from "@/lib/attendanceSchedule";
import { getSession } from "@/lib/auth";
import AttendanceSubNav from "@/components/AttendanceSubNav";

export default async function AdminLeaderAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const [years, session] = await Promise.all([getLeaderScoutingYears(), getSession()]);
  const { year: requestedYear } = await searchParams;
  const scoutingYear = requestedYear && years.includes(requestedYear) ? requestedYear : years[0];
  const canManage = session?.role === "ADMIN";

  const { activeCount, dates } = await getAdultLeaderMeetingOverview(scoutingYear);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Attendance</div>
          <h2>Leaders &amp; Committee</h2>
          <p>Same Friday meeting calendar as the scouts — a date marked No Meeting is cancelled here too.</p>
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
        <a
          className="btn btn-quiet"
          href={`/api/attendance/export/leaders?scoutingYear=${encodeURIComponent(scoutingYear)}`}
        >
          ⬇ Export {scoutingYear} CSV
        </a>
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

      <div className="meeting-list">
        {dates.map((m) =>
          m.status === "NO_MEETING" ? (
            <Link className="meeting-row no-meeting" href={`/portal/admin/attendance/leaders/${m.id}`} key={m.id}>
              <span className="meeting-date-label">{formatMeetingDate(m.date)}</span>
              <span className="badge-pill badge-cancelled">No Meeting</span>
            </Link>
          ) : (
            <Link className="meeting-row" href={`/portal/admin/attendance/leaders/${m.id}`} key={m.id}>
              <span className="meeting-date-label">{formatMeetingDate(m.date)}</span>
              <span className="meeting-summary">
                {m.listedCount === 0 ? "Nobody on the list" : `${m.presentCount}/${m.listedCount} present`}
              </span>
            </Link>
          )
        )}
      </div>
    </>
  );
}
