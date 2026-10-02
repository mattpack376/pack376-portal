import Link from "next/link";
import { requireCalendarSession } from "@/lib/authorize";
import CalendarEventForm from "@/components/CalendarEventForm";
import { createCalendarEventAction } from "@/lib/actions/calendar";

export default async function NewCalendarEventPage() {
  await requireCalendarSession();

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Calendar</div>
        <h2>Add an Event</h2>
        <p>
          <Link href="/portal/admin/calendar">← Back to the calendar</Link>
        </p>
      </div>
      <div className="info-card" style={{ maxWidth: 640 }}>
        <form action={createCalendarEventAction}>
          <CalendarEventForm idPrefix="new" />
          <button type="submit" className="btn btn-primary">
            Add Event
          </button>
        </form>
      </div>
    </>
  );
}
