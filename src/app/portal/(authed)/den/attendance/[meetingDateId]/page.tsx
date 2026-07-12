import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/authorize";
import { getMeetingDetailForDen } from "@/lib/attendanceData";
import { formatMeetingDate } from "@/lib/attendanceSchedule";
import { denDisplayName } from "@/lib/rankConfig";
import AttendanceControl from "@/components/AttendanceControl";
import MarkAllPresentButton from "@/components/MarkAllPresentButton";

export default async function DenMeetingAttendancePage({
  params,
}: {
  params: Promise<{ meetingDateId: string }>;
}) {
  const session = await requireSession();
  if (session.role !== "DEN" || !session.denId) {
    redirect("/portal/admin/attendance");
  }

  const { meetingDateId } = await params;
  const data = await getMeetingDetailForDen(session.denId, meetingDateId);
  if (!data) notFound();

  const { den, meeting, scouts } = data;
  const cancelled = meeting.status === "NO_MEETING";

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">
          <Link href="/portal/den/attendance">← All Meetings</Link>
        </div>
        <h2>{formatMeetingDate(meeting.date)}</h2>
        <p>{denDisplayName(den.rank, den.scoutingYear, den.label)}</p>
      </div>

      {cancelled ? (
        <div className="info-card">This meeting was cancelled — no attendance to take.</div>
      ) : (
        <>
          {scouts.length > 1 && (
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
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}
