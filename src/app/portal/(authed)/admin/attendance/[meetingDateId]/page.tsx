import { notFound } from "next/navigation";
import Link from "next/link";
import { getMeetingDetailForAdmin } from "@/lib/attendanceData";
import { formatMeetingDate } from "@/lib/attendanceSchedule";
import { RANK_INFO } from "@/lib/rankConfig";
import AttendanceControl from "@/components/AttendanceControl";
import MarkAllPresentButton from "@/components/MarkAllPresentButton";
import MeetingStatusToggle from "@/components/MeetingStatusToggle";

export default async function AdminMeetingAttendancePage({
  params,
}: {
  params: Promise<{ meetingDateId: string }>;
}) {
  const { meetingDateId } = await params;
  const data = await getMeetingDetailForAdmin(meetingDateId);
  if (!data) notFound();

  const { meeting, scoutingYear, dens } = data;
  const cancelled = meeting.status === "NO_MEETING";

  return (
    <>
      <div className="section-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div className="eyebrow">
            <Link href="/portal/admin/attendance">← All Meetings</Link>
          </div>
          <h2>{formatMeetingDate(meeting.date)}</h2>
          <p>{scoutingYear} — every den, in one place.</p>
        </div>
        <MeetingStatusToggle meetingDateId={meeting.id} status={meeting.status} />
      </div>

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
                {den.scouts.length > 1 && (
                  <div style={{ margin: "10px 0" }}>
                    <MarkAllPresentButton denId={den.id} meetingDateId={meeting.id} />
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
