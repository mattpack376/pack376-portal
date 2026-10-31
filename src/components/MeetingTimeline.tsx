import { currentMeetingTag, splitMeetingTimeline, type AttendanceLockRule } from "@/lib/attendanceLock";

/**
 * The attendance date list as a scroll: dates that have passed (locked) roll
 * up into a closed "Past Meetings" bar on top, newest first inside, and the
 * date to take attendance for leads the open list, highlighted. A season
 * that's over has nothing ahead, so its past bar starts open.
 */
export default function MeetingTimeline<T extends { id: string; date: Date; status: string }>({
  dates,
  lockRule,
  renderRow,
}: {
  dates: T[];
  /** When attendance locks — getAttendanceLockRule(). A date moves to Past Meetings at its lock. */
  lockRule: AttendanceLockRule;
  renderRow: (meeting: T) => React.ReactNode;
}) {
  const now = new Date();
  const { past, upcoming, current } = splitMeetingTimeline(dates, lockRule, now);

  return (
    <div className="meeting-list">
      {past.length > 0 && (
        <details className="meeting-past" open={upcoming.length === 0}>
          <summary className="den-toggle">Past Meetings ({past.length})</summary>
          <div className="meeting-list">{[...past].reverse().map(renderRow)}</div>
        </details>
      )}
      {upcoming.map((m) =>
        m === current ? (
          <div className="meeting-current" key={m.id}>
            <div className="meeting-current-tag">{currentMeetingTag(m.date, lockRule, now)}</div>
            {renderRow(m)}
          </div>
        ) : (
          renderRow(m)
        )
      )}
    </div>
  );
}
