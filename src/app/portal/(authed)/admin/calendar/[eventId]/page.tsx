import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminSession } from "@/lib/authorize";
import SaveButton from "@/components/SaveButton";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import CalendarEventForm from "@/components/CalendarEventForm";
import { getCalendarEventById } from "@/lib/calendarEventsData";
import {
  deleteCalendarEventAction,
  toggleCalendarEventVisibilityAction,
  updateCalendarEventAction,
} from "@/lib/actions/calendar";

export default async function EditCalendarEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  // Editing, hiding and deleting are Admin-only; everyone else reads the list.
  await requireAdminSession();
  const { eventId } = await params;
  const event = await getCalendarEventById(eventId);
  if (!event) notFound();

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Calendar</div>
        <h2>{event.title}</h2>
        <p>
          <Link href="/portal/admin/calendar">← Back to the calendar</Link>
        </p>
      </div>

      <div className="info-card" style={{ maxWidth: 640 }}>
        {!event.visible && (
          <span className="badge-pill badge-pending" style={{ display: "inline-block", marginBottom: 12 }}>
            Hidden from site
          </span>
        )}
        <form action={updateCalendarEventAction}>
          <input type="hidden" name="id" value={event.id} />
          <CalendarEventForm event={event} idPrefix={`edit-${event.id}`} />
          <SaveButton className="btn btn-primary">Save Changes</SaveButton>
        </form>

        <div style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
          <form action={toggleCalendarEventVisibilityAction}>
            <input type="hidden" name="id" value={event.id} />
            <input type="hidden" name="visible" value={String(event.visible)} />
            <button type="submit" className="btn btn-quiet btn-small">
              {event.visible ? "Hide from Site" : "Show on Site"}
            </button>
          </form>
          <form action={deleteCalendarEventAction}>
            <input type="hidden" name="id" value={event.id} />
            <ConfirmSubmitButton
              className="btn btn-danger btn-small"
              pendingLabel="Deleting…"
              message={`Delete the calendar event “${event.title}”? This can't be undone.`}
            >
              Delete
            </ConfirmSubmitButton>
          </form>
        </div>
      </div>
    </>
  );
}
