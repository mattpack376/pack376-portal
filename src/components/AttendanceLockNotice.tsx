import { attendanceLockLabel, type AttendanceLockRule } from "@/lib/attendanceLock";

/**
 * Tells the viewer where a meeting stands against the attendance lock (see
 * attendanceLock.ts). `locked` is the viewer's own answer — a locked meeting
 * an Admin can still edit is passed locked={false}, with `lockedForOthers` set
 * so they know why everyone else is read-only.
 */
export default function AttendanceLockNotice({
  meetingDate,
  lockRule,
  locked,
  lockedForOthers,
}: {
  meetingDate: Date;
  /** When attendance locks — getAttendanceLockRule(). */
  lockRule: AttendanceLockRule;
  /** True when this viewer can't edit because the meeting has locked. */
  locked: boolean;
  /** True when the meeting has locked but this viewer (an Admin) is still allowed to edit it. */
  lockedForOthers: boolean;
}) {
  if (locked) {
    return (
      <div className="info-card">
        Attendance for this meeting locked at {attendanceLockLabel(meetingDate, lockRule)}. It&apos;s read-only now — an Admin can
        still make changes.
      </div>
    );
  }
  if (lockedForOthers) {
    return (
      <div className="info-card">
        This meeting&apos;s attendance locked at {attendanceLockLabel(meetingDate, lockRule)}. Only Admins can edit it now, and
        you&apos;re one.
      </div>
    );
  }
  return (
    <p className="form-note">
      Attendance closes to everyone but Admins on {attendanceLockLabel(meetingDate, lockRule)}.
    </p>
  );
}
