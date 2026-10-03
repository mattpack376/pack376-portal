import Link from "next/link";

export type NextMeetingCardData = {
  /** The next regular meeting, already formatted for display. */
  formatted: string;
  /** What took away the Fridays before it — a camping trip, a No Meeting entry, a cancelled night. */
  skipped: { when: string; title: string; camping: boolean }[];
} | null;

/**
 * The parent dashboard's Next Meeting card, shared by the dashboard itself and
 * Family View's preview of it. The date comes from the calendar (see
 * findNextMeeting), and any Friday that isn't a meeting before it is listed so
 * a parent can tell why the next meeting isn't this week.
 */
export default function NextMeetingCard({ nextMeeting, wide = false }: { nextMeeting: NextMeetingCardData; wide?: boolean }) {
  return (
    <div className={`info-card${wide ? " two-col-full" : ""}`}>
      <h3>🗓️ Next Meeting</h3>
      {nextMeeting ? (
        <p style={{ fontSize: 18, fontWeight: 700, color: "var(--scout-blue-dark)" }}>{nextMeeting.formatted}</p>
      ) : (
        <p>No meeting date on the calendar yet.</p>
      )}
      {nextMeeting && nextMeeting.skipped.length > 0 && (
        <>
          <p className="form-note" style={{ marginTop: 12, marginBottom: 4, fontWeight: 700 }}>
            No Scout Meeting before then
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {nextMeeting.skipped.map((skip) => (
              <li key={`${skip.when}-${skip.title}`}>
                <strong>{skip.when}</strong> — {skip.camping && "⛺ "}
                {skip.title}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="form-note" style={{ marginTop: 12 }}>
        Weekly meetings — Fridays, 7:30–9:30 PM, Veltri Hall, Our Lady of Grace.{" "}
        <Link href="/calendar" style={{ fontWeight: 700, textDecoration: "underline" }}>
          See the full calendar →
        </Link>
      </p>
    </div>
  );
}
