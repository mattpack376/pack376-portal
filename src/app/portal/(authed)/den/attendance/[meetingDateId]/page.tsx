import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { requireSession, homeForRole } from "@/lib/authorize";
import { getMeetingDetailForDen } from "@/lib/attendanceData";
import { formatMeetingDate } from "@/lib/attendanceSchedule";
import { denDisplayName } from "@/lib/rankConfig";
import { canEditMeetingAttendance } from "@/lib/attendanceLock";
import AttendanceControl from "@/components/AttendanceControl";
import AttendanceLockNotice from "@/components/AttendanceLockNotice";
import MarkAllPresentButton from "@/components/MarkAllPresentButton";

export default async function DenMeetingAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ meetingDateId: string }>;
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

  const { meetingDateId } = await params;
  const { denId: requestedDenId } = await searchParams;
  const denId = requestedDenId && session.denIds.includes(requestedDenId) ? requestedDenId : session.denIds[0];
  const data = await getMeetingDetailForDen(denId, meetingDateId);
  if (!data) notFound();

  const { den, meeting, eventLabel, scouts } = data;
  const cancelled = meeting.status === "NO_MEETING";
  // Past noon the day after the meeting, only Admins can edit — see attendanceLock.ts.
  const canEdit = canEditMeetingAttendance(session.role, meeting.date);

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">
          <Link href={`/portal/den/attendance?denId=${denId}`}>← All Meetings</Link>
        </div>
        <h2>{formatMeetingDate(meeting.date, eventLabel)}</h2>
        <p>{denDisplayName(den.rank, den.scoutingYear, den.label)}</p>
      </div>

      <AttendanceLockNotice meetingDate={meeting.date} locked={!canEdit} lockedForOthers={false} />

      {cancelled ? (
        <div className="info-card">This meeting was cancelled — no attendance to take.</div>
      ) : (
        <>
          {canEdit && scouts.length > 1 && (
            <div style={{ marginBottom: 16 }}>
              <MarkAllPresentButton denId={den.id} meetingDateId={meeting.id} />
            </div>
          )}
          <div className="attendance-card">
            {scouts.length === 0 && <p style={{ padding: "12px 0" }}>No scouts on this roster yet.</p>}
            {scouts.map((scout) => (
              <AttendanceControl
                // Remounts (resetting local toggle state) whenever the server's
                // view of `present` changes underneath it — e.g. after "Mark All
                // Present" calls router.refresh(), since useState's initial value
                // is only read on first mount otherwise.
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
        </>
      )}
    </>
  );
}
