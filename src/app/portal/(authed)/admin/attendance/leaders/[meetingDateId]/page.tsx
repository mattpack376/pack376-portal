import { notFound } from "next/navigation";
import Link from "next/link";
import { getAdultLeaderMeetingDetail } from "@/lib/adultLeaderAttendanceData";
import { formatMeetingDate } from "@/lib/attendanceSchedule";
import { getSession } from "@/lib/auth";
import { canResetLeaderAttendance } from "@/lib/authorize";
import AttendanceSubNav from "@/components/AttendanceSubNav";
import LeaderAttendanceControl from "@/components/LeaderAttendanceControl";
import MarkAllLeadersPresentButton from "@/components/MarkAllLeadersPresentButton";
import MeetingStatusToggle from "@/components/MeetingStatusToggle";
import ResetLeaderAttendanceButton from "@/components/ResetLeaderAttendanceButton";

export default async function AdminLeaderMeetingAttendancePage({
  params,
}: {
  params: Promise<{ meetingDateId: string }>;
}) {
  const { meetingDateId } = await params;
  const [data, session] = await Promise.all([getAdultLeaderMeetingDetail(meetingDateId), getSession()]);
  if (!data) notFound();
  const canReset = !!session && canResetLeaderAttendance(session);

  const { meeting, scoutingYear, sections } = data;
  const cancelled = meeting.status === "NO_MEETING";
  const listedCount = sections.reduce((sum, s) => sum + s.leaders.length, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link href={`/portal/admin/attendance/leaders?year=${encodeURIComponent(scoutingYear)}`}>← All Meetings</Link>
          </div>
          <h2>{formatMeetingDate(meeting.date)}</h2>
          <p>{scoutingYear} — leaders &amp; committee.</p>
        </div>
        <MeetingStatusToggle meetingDateId={meeting.id} status={meeting.status} />
      </div>

      <AttendanceSubNav active="leaders" meetingDateId={meeting.id} />

      {cancelled ? (
        <div className="info-card">This meeting was cancelled — no attendance to take.</div>
      ) : listedCount === 0 ? (
        <div className="info-card">Nobody is on the leader &amp; committee list yet.</div>
      ) : (
        <>
          {(listedCount > 1 || canReset) && (
            <div style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {listedCount > 1 && <MarkAllLeadersPresentButton meetingDateId={meeting.id} />}
              {canReset && <ResetLeaderAttendanceButton meetingDateId={meeting.id} />}
            </div>
          )}

          {sections
            .filter((section) => section.leaders.length > 0)
            .map((section) => {
              const presentCount = section.leaders.filter((l) => l.present === true).length;
              return (
                <div className="attendance-group" key={section.section}>
                  <div className="attendance-group-head">
                    <h3 style={{ marginBottom: 0 }}>{section.label}</h3>
                    <span className="progress-pill">
                      {presentCount}/{section.leaders.length} present
                    </span>
                  </div>
                  <div className="attendance-card">
                    {section.leaders.map((leader) => (
                      <LeaderAttendanceControl
                        // Remounts on a server-side change (e.g. after "Mark All
                        // Present" refreshes) — same reason as AttendanceControl's key.
                        key={`${leader.id}-${leader.present}`}
                        adultLeaderId={leader.id}
                        meetingDateId={meeting.id}
                        name={leader.name}
                        positions={leader.positions}
                        active={leader.active}
                        initialPresent={leader.present}
                        updatedAt={leader.updatedAt}
                        updatedByUsername={leader.updatedByUsername}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
        </>
      )}
    </>
  );
}
