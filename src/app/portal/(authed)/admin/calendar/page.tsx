import Link from "next/link";
import { requireCalendarSession } from "@/lib/authorize";
import SaveButton from "@/components/SaveButton";
import CalendarDateFields from "@/components/CalendarDateFields";
import CollapsibleGroup from "@/components/CollapsibleGroup";
import { getAllCalendarEvents, getMeetingRule } from "@/lib/calendarEventsData";
import { toggleCalendarEventVisibilityAction, updateMeetingRuleAction } from "@/lib/actions/calendar";
import {
  AUDIENCE_LABELS,
  CATEGORY_PILL,
  badgeParts,
  isMonthPast,
  monthTitle,
  type AdminCalendarEvent,
} from "@/lib/calendarData";
import { todayDateOnlyString } from "@/lib/dateOnly";
import { getPublicBaseUrl } from "@/lib/appUrl";

function EventRow({ event }: { event: AdminCalendarEvent }) {
  const pill = CATEGORY_PILL[event.category];
  const badge = event.date
    ? badgeParts({ date: event.date, endDate: event.endDate ?? undefined, eitherDay: event.eitherDay })
    : { top: "Date", bottom: "TBD" };
  return (
    <li className={`cal-ev cal-cat--${event.category}${event.visible ? "" : " cal-ev--hidden"}`}>
      <div className="cal-date" aria-hidden="true">
        <span className="cal-date-dow">{badge.top}</span>
        <span className={`cal-date-day${event.endDate || !event.date ? " cal-date-day--range" : ""}`}>{badge.bottom}</span>
      </div>
      <div className="cal-ev-body">
        <h3 className="cal-ev-title">{event.title}</h3>
        {event.detail && <p className="cal-ev-detail">{event.detail}</p>}
      </div>
      <div className="cal-ev-side">
        {pill && (
          <span className="cal-pill">
            <span aria-hidden="true">{pill.icon}</span> {pill.label}
          </span>
        )}
        {event.audience && <span className="cal-tag">{AUDIENCE_LABELS[event.audience]}</span>}
        {event.noMeeting && <span className="cal-tag">No Meeting</span>}
        {event.glance && <span className="cal-tag">★ Year at a Glance</span>}
        {!event.visible && <span className="cal-tag">Hidden from site</span>}
        <Link className="btn btn-quiet btn-small" href={`/portal/admin/calendar/${event.id}`}>
          Edit
        </Link>
        <form action={toggleCalendarEventVisibilityAction}>
          <input type="hidden" name="id" value={event.id} />
          <input type="hidden" name="visible" value={String(event.visible)} />
          <button type="submit" className="btn btn-quiet btn-small">
            {event.visible ? "Hide" : "Show"}
          </button>
        </form>
      </div>
    </li>
  );
}

export default async function CalendarAdminPage() {
  await requireCalendarSession();
  const [events, rule] = await Promise.all([getAllCalendarEvents(), getMeetingRule()]);
  const today = todayDateOnlyString();

  const undated = events.filter((e) => !e.date);
  const byMonth = new Map<string, AdminCalendarEvent[]>();
  for (const e of events) {
    if (!e.date) continue;
    const key = e.date.slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) ?? []), e]);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Admin</div>
          <h2>Calendar of Events</h2>
          <p>
            Everything on the public calendar. Changes show up on the website right away. The year at the top of the
            page switches on July 1, so next season can be entered over the summer.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a className="btn btn-quiet" href={`${getPublicBaseUrl()}/calendar`} target="_blank" rel="noopener noreferrer">
            View on site
          </a>
          <Link className="btn btn-primary" href="/portal/admin/calendar/new">
            + Add Event
          </Link>
        </div>
      </div>

      <div className="info-card" style={{ marginBottom: 28 }}>
        <h3>Regular Friday Meeting</h3>
        <p className="form-note" style={{ marginTop: 0, marginBottom: 16 }}>
          Every Friday between the first and last meeting dates gets this entry on the calendar — except a Friday that
          already has something on it: a campout, a pack night, a registration night, or a “No Meeting” entry. Add or
          remove one of those and the regular meeting adjusts on its own.
        </p>
        <form action={updateMeetingRuleAction}>
          <label className="cal-check">
            <input type="checkbox" name="enabled" defaultChecked={rule?.enabled ?? true} />
            <span>Show the regular meeting on the calendar</span>
          </label>
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="meeting-title">Name</label>
              <input id="meeting-title" name="title" required maxLength={60} defaultValue={rule?.title ?? "Scout Meeting"} />
            </div>
            <div className="form-field">
              <label htmlFor="meeting-detail">Time</label>
              <input id="meeting-detail" name="detail" maxLength={60} defaultValue={rule?.detail ?? "7:30 – 9:30 PM"} />
            </div>
          </div>
          <CalendarDateFields
            idPrefix="meeting"
            startName="startDate"
            endName="endDate"
            startLabel="First meeting"
            endLabel="Last meeting"
            date={rule?.startDate ?? null}
            endDate={rule?.endDate ?? null}
            sameDayOk
            required
          />
          <SaveButton className="btn btn-primary btn-small">Save Meeting</SaveButton>
        </form>
      </div>

      {events.length === 0 && (
        <div className="info-card">
          <p>No events yet — add one above.</p>
        </div>
      )}

      {undated.length > 0 && (
        <div className="event-month-group">
          <CollapsibleGroup label={`No date yet (${undated.length})`}>
            <ol className="cal-events" style={{ margin: "10px 0 20px" }}>
              {undated.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </ol>
          </CollapsibleGroup>
        </div>
      )}

      {[...byMonth.entries()].map(([key, monthEvents]) => (
        <div className="event-month-group" key={key}>
          <CollapsibleGroup label={`${monthTitle(key)} (${monthEvents.length})`} defaultOpen={!isMonthPast(key, today)}>
            <ol className="cal-events" style={{ margin: "10px 0 20px" }}>
              {monthEvents.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </ol>
          </CollapsibleGroup>
        </div>
      ))}
    </>
  );
}
