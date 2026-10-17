import { currentMeetingTag, splitMeetingTimeline } from "@/lib/attendanceLock";

/**
 * The attendance date list as a scroll: dates that have passed (locked) roll
 * up into a closed "Past Meetings" bar on top, newest first inside, and the
 * date to take attendance for leads the open list, highlighted. A season
 * that's over has nothing ahead, so its past bar starts open.
 */
export default function MeetingTimeline<T extends { id: string; date: Date; status: string }>({
  dates,
  renderRow,
}: {
  dates: T[];
  renderRow: (meeting: T) => React.ReactNode;
}) {
  const now = new Date();
  const { past, upcoming, current } = splitMeetingTimeline(dates, now);

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
            <div className="meeting-current-tag">{currentMeetingTag(m.date, now)}</div>
            {renderRow(m)}
          </div>
        ) : (
          renderRow(m)
        )
      )}
    </div>
  );
}
