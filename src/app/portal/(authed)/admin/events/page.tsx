import Link from "next/link";
import { requireAdminSession } from "@/lib/authorize";
import { getEvents } from "@/lib/eventsData";
import { formatCents } from "@/lib/duesData";
import { DEADLINE_CATEGORY_LABELS, formatDueDate } from "@/lib/deadlineCategories";
import { createEventAction } from "@/lib/actions/events";

export default async function AdminEventsPage() {
  await requireAdminSession();
  const events = await getEvents();

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Admin</div>
        <h2>Events</h2>
        <p>Track camping trips, day trips, and special events scouts sign up for — who&apos;s registered and what they owe.</p>
      </div>

      {events.length === 0 ? (
        <div className="info-card" style={{ marginBottom: 24 }}>
          <p style={{ marginBottom: 0 }}>No events yet — add one below.</p>
        </div>
      ) : (
        <table className="data-table" style={{ marginBottom: 32 }}>
          <thead>
            <tr>
              <th>Event</th>
              <th>Date</th>
              <th>Registered</th>
              <th>Collected</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>
                  <span className="form-note" style={{ display: "block" }}>
                    {DEADLINE_CATEGORY_LABELS[event.category].toUpperCase()}
                  </span>
                  {event.title}
                </td>
                <td>{formatDueDate(event.eventDate)}</td>
                <td>{event.registrationCount}</td>
                <td>
                  {formatCents(event.totalPaidCents)} / {formatCents(event.totalOwedCents)}
                </td>
                <td className="actions">
                  <Link
                    className="btn btn-outline btn-small"
                    style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
                    href={`/portal/admin/events/${event.id}`}
                  >
                    Manage
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="info-card" style={{ maxWidth: 460 }}>
        <h3 style={{ marginTop: 0 }}>Add an Event</h3>
        <form action={createEventAction}>
          <div className="form-field">
            <label htmlFor="title">Title</label>
            <input id="title" name="title" required placeholder="e.g. Camp Conron Weekend" />
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="form-field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="category">Category</label>
              <select id="category" name="category" defaultValue="CAMPING">
                {Object.entries(DEADLINE_CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="form-field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="eventDate">Date</label>
              <input id="eventDate" name="eventDate" type="date" required />
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="fee">Default Fee Per Scout ($, optional)</label>
            <input id="fee" name="fee" type="number" min="0" step="0.01" placeholder="Applied when you register a scout — editable per scout" />
          </div>
          <div className="form-field">
            <label htmlFor="description">Description (optional)</label>
            <textarea id="description" name="description" rows={2} />
          </div>
          <button type="submit" className="btn btn-primary">Create Event</button>
        </form>
      </div>
    </>
  );
}
