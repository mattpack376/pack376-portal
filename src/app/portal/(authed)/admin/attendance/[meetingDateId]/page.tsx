import { notFound } from "next/navigation";
import Link from "next/link";
import { getMeetingDetailForAdmin } from "@/lib/attendanceData";
import { formatMeetingDate } from "@/lib/attendanceSchedule";
import { RANK_INFO } from "@/lib/rankConfig";
import { getSession } from "@/lib/auth";
import { canAccessLeaderAttendance, canResetDenAttendance } from "@/lib/authorize";
import { canEditMeetingAttendance, isAttendanceLocked } from "@/lib/attendanceLock";
import AttendanceControl from "@/components/AttendanceControl";
import AttendanceLockNotice from "@/components/AttendanceLockNotice";
import AttendanceSubNav from "@/components/AttendanceSubNav";
import MarkAllPresentButton from "@/components/MarkAllPresentButton";
import MeetingLabelForm from "@/components/MeetingLabelForm";
import MeetingStatusToggle from "@/components/MeetingStatusToggle";
import ResetDenAttendanceButton from "@/components/ResetDenAttendanceButton";

export default async function AdminMeetingAttendancePage({
  params,
}: {
  params: Promise<{ meetingDateId: string }>;
}) {
  const { meetingDateId } = await params;
  const [data, session] = await Promise.all([getMeetingDetailForAdmin(meetingDateId), getSession()]);
  if (!data) notFound();
  const { meeting, eventLabel, scoutingYear, dens } = data;
  // Past noon the day after the meeting, only Admins can edit — see attendanceLock.ts.
  const canEdit = !!session && canEditMeetingAttendance(session.role, meeting.date);
  const meetingLocked = isAttendanceLocked(meeting.date);
  const canReset = canEdit && !!session && canResetDenAttendance(session);
  const cancelled = meeting.status === "NO_MEETING";

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link href="/portal/admin/attendance">← All Meetings</Link>
          </div>
          <h2>{formatMeetingDate(meeting.date, eventLabel)}</h2>
          <p>{scoutingYear} — every den, in one place.</p>
        </div>
        {canEdit && <MeetingStatusToggle meetingDateId={meeting.id} status={meeting.status} />}
      </div>

      {session && canAccessLeaderAttendance(session) && (
        <AttendanceSubNav active="scouts" meetingDateId={meeting.id} />
      )}

      {canEdit && <MeetingLabelForm meetingDateId={meeting.id} label={meeting.label} />}
      <AttendanceLockNotice meetingDate={meeting.date} locked={!canEdit} lockedForOthers={canEdit && meetingLocked} />

      {cancelled ? (
        <div className="info-card">This meeting was cancelled — no attendance to take.</div>
      ) : (
        <>
          {dens.length > 1 && (
            <div className="attendance-jump-links">
              {dens.map((den) => (
                <a key={den.id} href={`#den-${den.id}`}>
                  {RANK_INFO[den.rank].label}{den.label ? ` ${den.label}` : ""}
                </a>
              ))}
            </div>
          )}

          {dens.map((den) => {
            const presentCount = den.scouts.filter((s) => s.present === true).length;
            return (
              <div className="attendance-group" id={`den-${den.id}`} key={den.id}>
                <div className="attendance-group-head">
                  <h3 style={{ marginBottom: 0 }}>
                    {RANK_INFO[den.rank].label}{den.label ? ` ${den.label}` : ""}
                  </h3>
                  <span className="progress-pill">
                    {den.scouts.length === 0 ? "No scouts" : `${presentCount}/${den.scouts.length} present`}
                  </span>
                </div>
                {((canEdit && den.scouts.length > 1) || canReset) && (
                  <div style={{ margin: "10px 0", display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {canEdit && den.scouts.length > 1 && <MarkAllPresentButton denId={den.id} meetingDateId={meeting.id} />}
                    {canReset && den.scouts.length > 0 && (
                      <ResetDenAttendanceButton
                        denId={den.id}
                        meetingDateId={meeting.id}
                        denName={`${RANK_INFO[den.rank].label}${den.label ? ` ${den.label}` : ""}`}
                      />
                    )}
                  </div>
                )}
                <div className="attendance-card">
                  {den.scouts.length === 0 && <p style={{ padding: "12px 0" }}>No scouts on this roster yet.</p>}
                  {den.scouts.map((scout) => (
                    <AttendanceControl
                      key={`${scout.id}-${scout.present}`}
                      scoutId={scout.id}
                      meetingDateId={meeting.id}
                      firstName={scout.firstName}
                      lastName={scout.lastName}
                      initialPresent={scout.present}
                      updatedAt={scout.updatedAt}
                      updatedByUsername={scout.updatedByUsername}
                      locked={!canEdit}
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
