import EventFlyer from "@/components/EventFlyer";
import { CATEGORY_PILL, PUBLIC_CALENDAR_URL } from "@/lib/calendarData";
import { DEADLINE_CATEGORY_ICONS, DEADLINE_CATEGORY_LABELS, formatDueDate } from "@/lib/deadlineCategories";
import { calendarWhenLabel, type UpcomingItem } from "@/lib/parentUpcoming";

/**
 * The Parent Dashboard's "Upcoming Events" list, shared by the dashboard and
 * Family View's preview of it. Registration events (with their flyers) and the
 * calendar's family-facing events sit in one date-ordered list — see
 * parentUpcoming.ts for what's included and how duplicates are dropped.
 */
export default function UpcomingEventsSection({ items }: { items: UpcomingItem[] }) {
  return (
    <>
      <div className="section-head">
        <div className="eyebrow">What&apos;s Coming Up</div>
        <h2>🎉 Upcoming Events</h2>
      </div>
      {items.length === 0 ? (
        <div className="info-card" style={{ marginBottom: 12 }}>
          <p>No upcoming events posted right now.</p>
        </div>
      ) : (
        <div className="resource-grid" style={{ marginBottom: 12 }}>
          {items.map((item) => {
            if (item.kind === "event") {
              return (
                <div className="resource-card" key={`event-${item.id}`}>
                  <div className="icon-badge">{DEADLINE_CATEGORY_ICONS[item.category]}</div>
                  <div>
                    <p className="form-note" style={{ marginBottom: 4 }}>
                      {DEADLINE_CATEGORY_LABELS[item.category].toUpperCase()} · {formatDueDate(item.eventDate)}
                    </p>
                    <h3>{item.title}</h3>
                    {item.description && <p style={{ marginBottom: 10 }}>{item.description}</p>}
                    <EventFlyer flyerUrl={item.flyerUrl} title={item.title} />
                  </div>
                </div>
              );
            }
            const { event } = item;
            const pill = CATEGORY_PILL[event.category];
            return (
              <div className="resource-card" key={`calendar-${item.key}`}>
                <div className="icon-badge">{pill?.icon ?? "📅"}</div>
                <div>
                  <p className="form-note" style={{ marginBottom: 4 }}>
                    {(pill?.label ?? "Event").toUpperCase()} · {calendarWhenLabel(event)}
                    {event.tbd && " · TBD"}
                  </p>
                  <h3>{event.title}</h3>
                  {event.detail && <p style={{ marginBottom: 10 }}>{event.detail}</p>}
                  {event.volunteer === "all-hands" && (
                    <p style={{ marginBottom: 10 }}>🙋 All hands on deck — volunteers welcome.</p>
                  )}
                  {event.link && (
                    <a className="link" href={event.link.href} target="_blank" rel="noopener noreferrer">
                      {event.link.label} →
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="form-note" style={{ marginBottom: 32 }}>
        The next few from the pack calendar.{" "}
        <a href={PUBLIC_CALENDAR_URL} style={{ fontWeight: 700, textDecoration: "underline" }}>
          See the full calendar →
        </a>
      </p>
    </>
  );
}
