import Link from "next/link";
import { getAdminScoutingYears, getAdminMeetingOverview } from "@/lib/attendanceData";
import { formatMeetingDate } from "@/lib/attendanceSchedule";

export default async function AdminAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const years = await getAdminScoutingYears();
  const { year: requestedYear } = await searchParams;
  const scoutingYear = requestedYear && years.includes(requestedYear) ? requestedYear : years[0];

  if (!scoutingYear) {
    return <div className="info-card">No dens exist yet — create one from the Dashboard first.</div>;
  }

  const { totalScouts, dates } = await getAdminMeetingOverview(scoutingYear);

  return (
    <>
      <div className="section-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
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
          <button type="submit" className="btn btn-outline" style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}>
            Go
          </button>
        </form>
      </div>

      <div style={{ marginBottom: 16 }}>
        <a className="btn btn-outline" style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }} href={`/api/attendance/export/pack?scoutingYear=${encodeURIComponent(scoutingYear)}`}>
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
