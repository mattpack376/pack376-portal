import CalendarDateFields from "@/components/CalendarDateFields";
import { AUDIENCE_LABELS, CATEGORIES, GLANCE_CATEGORIES, type AdminCalendarEvent } from "@/lib/calendarData";

/** What a category looks like on the public calendar, so the dropdown shows it. */
const COLOR_HINT: Record<string, string> = {
  camping: "red",
  "pack-night": "gold",
  "one-day": "green",
  fundraiser: "cream",
  "scout-sunday": "purple",
  general: "",
};

/**
 * The fields of the calendar event form, shared by Add Event and the edit page.
 * Fields only — the caller supplies the <form action>, the hidden id and the
 * buttons. Every control is uncontrolled (defaultValue), which survives
 * React 19's form reset on submit; a controlled select would not.
 *
 * The two <select>s are keyed on their saved value. React applies a select's
 * defaultValue only when it mounts, so without the key a saved change snaps
 * back on screen after the save (the form reset restores the option the
 * select was first rendered with), and the next save of any other field then
 * quietly writes the old choice back. A new key rebuilds the select with the
 * new saved value. Text inputs and checkboxes don't have this problem.
 */
export default function CalendarEventForm({
  event,
  idPrefix,
}: {
  event?: AdminCalendarEvent;
  idPrefix: string;
}) {
  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <>
      <div className="form-field">
        <label htmlFor={id("title")}>Title</label>
        <input
          id={id("title")}
          name="title"
          required
          maxLength={140}
          defaultValue={event?.title ?? ""}
          placeholder="e.g. Pack Halloween Party"
        />
      </div>

      <div className="form-row">
        <div className="form-field">
          <label htmlFor={id("category")}>Category (sets the color)</label>
          <select key={event?.category ?? "new"} id={id("category")} name="category" defaultValue={event?.category ?? "general"}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
                {COLOR_HINT[c.value] ? ` — ${COLOR_HINT[c.value]}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor={id("audience")}>Who it&apos;s for</label>
          <select key={event?.audience ?? "everyone"} id={id("audience")} name="audience" defaultValue={event?.audience ?? ""}>
            <option value="">Everyone</option>
            <option value="leaders">{AUDIENCE_LABELS.leaders}</option>
            <option value="all-hands">{AUDIENCE_LABELS["all-hands"]}</option>
          </select>
        </div>
      </div>

      <CalendarDateFields idPrefix={idPrefix} date={event?.date ?? null} endDate={event?.endDate ?? null} />
      <label className="cal-check">
        <input type="checkbox" name="eitherDay" defaultChecked={event?.eitherDay ?? false} />
        <span>
          The two dates are alternatives, not a span
          <small>Shows as “Sat or Sun” instead of “Sat–Sun”. Only matters when there&apos;s an end date.</small>
        </span>
      </label>

      <div className="form-field">
        <label htmlFor={id("detail")}>Details (optional)</label>
        <input
          id={id("detail")}
          name="detail"
          maxLength={200}
          defaultValue={event?.detail ?? ""}
          placeholder="Time, place, or a short note — e.g. 6:00 PM at Veltri Hall"
        />
      </div>

      <label className="cal-check">
        <input type="checkbox" name="noMeeting" defaultChecked={event?.noMeeting ?? false} />
        <span>
          No meeting this day
          <small>Greys the row. The regular Friday meeting is also left off a Friday that has one of these.</small>
        </span>
      </label>
      <label className="cal-check">
        <input type="checkbox" name="tbd" defaultChecked={event?.tbd ?? false} />
        <span>Date or details still to be decided (adds a “TBD” tag)</span>
      </label>
      <label className="cal-check">
        <input type="checkbox" name="important" defaultChecked={event?.important ?? false} />
        <span>
          Highlight this one
          <small>A gold outline, for something families must not miss.</small>
        </span>
      </label>

      <div className="form-row">
        <div className="form-field">
          <label htmlFor={id("linkUrl")}>Link (optional)</label>
          <input
            id={id("linkUrl")}
            name="linkUrl"
            type="url"
            // A browser calls "javascript:…" a valid URL, so say what's allowed here;
            // the Server Action refuses anything but http(s) as well.
            pattern="https?://.+"
            title="A full web address, starting with https://"
            maxLength={300}
            defaultValue={event?.linkUrl ?? ""}
            placeholder="https://…"
          />
        </div>
        <div className="form-field">
          <label htmlFor={id("linkLabel")}>Link text</label>
          <input
            id={id("linkLabel")}
            name="linkLabel"
            maxLength={40}
            defaultValue={event?.linkLabel ?? ""}
            placeholder="More info"
          />
        </div>
      </div>

      <fieldset className="cal-glance-fields">
        <legend>Year at a Glance box</legend>
        <label className="cal-check">
          <input type="checkbox" name="glance" defaultChecked={event?.glance ?? false} />
          <span>
            Feature this in the Year at a Glance box at the top
            <small>
              Works for {GLANCE_CATEGORIES.map((c) => CATEGORIES.find((x) => x.value === c)!.label.toLowerCase()).join(", ")}{" "}
              events. Scout Sundays have their own box. An event with no date yet shows there as “TBD”.
            </small>
          </span>
        </label>
        <div className="form-row">
          <div className="form-field">
            <label htmlFor={id("glanceLabel")}>Shorter name there (optional)</label>
            <input id={id("glanceLabel")} name="glanceLabel" maxLength={80} defaultValue={event?.glanceLabel ?? ""} />
          </div>
          <div className="form-field">
            <label htmlFor={id("glanceWhen")}>Date wording there (optional)</label>
            <input
              id={id("glanceWhen")}
              name="glanceWhen"
              maxLength={30}
              defaultValue={event?.glanceWhen ?? ""}
              placeholder="e.g. Early Nov"
            />
          </div>
        </div>
      </fieldset>
    </>
  );
}
