import { requireHomepageContentSession } from "@/lib/authorize";
import { getAllHomepageEvents } from "@/lib/homepageEventsData";
import { getAllSiteBanners, getActiveSiteBanner } from "@/lib/siteBannerData";
import { groupEventsByMonth } from "@/lib/groupEventsByMonth";
import { toPackDateTimeLocalValue, formatPackDateTime } from "@/lib/bannerSchedule";
import CollapsibleGroup from "@/components/CollapsibleGroup";
import {
  createHomepageEventAction,
  updateHomepageEventAction,
  toggleHomepageEventVisibilityAction,
  deleteHomepageEventAction,
} from "@/lib/actions/homepageEvents";
import {
  createSiteBannerAction,
  updateSiteBannerAction,
  toggleSiteBannerAction,
  deleteSiteBannerAction,
} from "@/lib/actions/siteBanner";

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function bannerStatus(
  banner: { active: boolean; startAt: Date | null; endAt: Date | null },
  now: Date,
  isShowingNow: boolean,
) {
  const isDefault = !banner.startAt && !banner.endAt;
  const notYetStarted = !!banner.startAt && banner.startAt > now;
  const expired = !!banner.endAt && banner.endAt < now;

  if (!banner.active) return { label: "Off", live: false };
  if (notYetStarted) return { label: "Scheduled", live: false };
  if (expired) return { label: "Expired", live: false };
  if (isDefault) return { label: isShowingNow ? "Default — showing now" : "Default", live: isShowingNow };
  return { label: "Live now", live: true };
}

export default async function HomepageEventsAdminPage() {
  const session = await requireHomepageContentSession();
  const canDelete = session.role === "ADMIN";
  const [events, banners, currentBanner] = await Promise.all([
    getAllHomepageEvents(),
    getAllSiteBanners(),
    getActiveSiteBanner(),
  ]);
  const eventsByMonth = groupEventsByMonth(events);
  const now = new Date();

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Admin</div>
        <h2>Homepage Content</h2>
        <p>
          Manage what shows on the public homepage — the top banner and the &quot;Upcoming Attractions&quot;
          ticket list.
        </p>
      </div>

      <div className="info-card" style={{ maxWidth: 480, marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Top Banner</h3>
        <p className="form-note" style={{ marginTop: 0, marginBottom: 16 }}>
          A short, urgent notice in a black bar with yellow text, shown just below the header. Give a banner a start
          and/or end time to pre-schedule it — it goes up and comes down automatically. Leave both blank to make it a
          default banner that shows whenever no scheduled banner is currently live.
        </p>
        <form action={createSiteBannerAction} style={{ marginBottom: banners.length > 0 ? 20 : 0 }}>
          <div className="form-field">
            <label htmlFor="new-banner-message">Message</label>
            <input id="new-banner-message" name="message" required placeholder="e.g. Meeting cancelled this Friday due to weather" />
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="form-field" style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="new-banner-startAt">Starts (optional)</label>
              <input id="new-banner-startAt" name="startAt" type="datetime-local" />
            </div>
            <div className="form-field" style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="new-banner-endAt">Ends (optional)</label>
              <input id="new-banner-endAt" name="endAt" type="datetime-local" />
            </div>
          </div>
          <p className="form-note" style={{ marginTop: -8, marginBottom: 16 }}>Times are Eastern (pack local time).</p>
          <button type="submit" className="btn btn-primary">Post Banner</button>
        </form>

        {banners.map((banner) => {
          const status = bannerStatus(banner, now, currentBanner?.id === banner.id);
          return (
            <div
              key={banner.id}
              style={{ background: "var(--cream)", borderRadius: 8, padding: "10px 14px", marginBottom: 8 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                <div>
                  <p style={{ marginBottom: 2, fontWeight: 700 }}>
                    {banner.message}{" "}
                    <span className={`badge-pill ${status.live ? "badge-attendance" : "badge-pending"}`}>
                      {status.label}
                    </span>
                  </p>
                  {(banner.startAt || banner.endAt) && (
                    <p className="form-note" style={{ marginBottom: 0 }}>
                      {banner.startAt && `Starts ${formatPackDateTime(banner.startAt)}`}
                      {banner.startAt && banner.endAt && " · "}
                      {banner.endAt && `Ends ${formatPackDateTime(banner.endAt)}`}
                    </p>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
                  <details className="edit-popover">
                    <summary className="btn btn-outline btn-small" style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)", display: "inline-block", cursor: "pointer" }}>
                      Edit
                    </summary>
                    <form action={updateSiteBannerAction}>
                      <input type="hidden" name="id" value={banner.id} />
                      <div className="form-field">
                        <label htmlFor={`banner-message-${banner.id}`}>Message</label>
                        <input id={`banner-message-${banner.id}`} name="message" defaultValue={banner.message} required />
                      </div>
                      <div className="form-field">
                        <label htmlFor={`banner-startAt-${banner.id}`}>Starts (optional)</label>
                        <input
                          id={`banner-startAt-${banner.id}`}
                          name="startAt"
                          type="datetime-local"
                          defaultValue={banner.startAt ? toPackDateTimeLocalValue(banner.startAt) : ""}
                        />
                      </div>
                      <div className="form-field">
                        <label htmlFor={`banner-endAt-${banner.id}`}>Ends (optional)</label>
                        <input
                          id={`banner-endAt-${banner.id}`}
                          name="endAt"
                          type="datetime-local"
                          defaultValue={banner.endAt ? toPackDateTimeLocalValue(banner.endAt) : ""}
                        />
                      </div>
                      <p className="form-note" style={{ marginTop: -8, marginBottom: 12 }}>Times are Eastern (pack local time).</p>
                      <button type="submit" className="btn btn-primary btn-small">Save Changes</button>
                    </form>
                  </details>
                  <form action={toggleSiteBannerAction}>
                    <input type="hidden" name="id" value={banner.id} />
                    <input type="hidden" name="active" value={String(banner.active)} />
                    <button type="submit" className="btn btn-outline btn-small" style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}>
                      Turn {banner.active ? "Off" : "On"}
                    </button>
                  </form>
                  {canDelete && (
                    <form action={deleteSiteBannerAction}>
                      <input type="hidden" name="id" value={banner.id} />
                      <button type="submit" className="btn btn-outline btn-small" style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}>
                        Delete
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="section-head">
        <div className="eyebrow">Upcoming Attractions</div>
        <h2>Homepage Events</h2>
        <p>Events drop off on their own once their sort date has passed — no need to delete old ones.</p>
      </div>

      <div className="info-card" style={{ maxWidth: 480, marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Add an Event</h3>
        <form action={createHomepageEventAction}>
          <div className="form-field">
            <label htmlFor="new-title">Title</label>
            <input id="new-title" name="title" required placeholder="e.g. Halloween Pack Night" />
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="form-field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="new-dateLabel">Date Label</label>
              <input id="new-dateLabel" name="dateLabel" required placeholder="e.g. Oct 30 or Oct 9–12" />
            </div>
            <div className="form-field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="new-sortDate">Sort Date</label>
              <input id="new-sortDate" name="sortDate" type="date" required />
            </div>
          </div>
          <p className="form-note" style={{ marginTop: -8, marginBottom: 16 }}>
            The date label is what visitors see (it can be a range or &quot;or&quot; phrasing) — sort date is
            only used to order the list and to drop the event off the homepage once it&apos;s past. For a
            multi-day range, use the first day.
          </p>
          <div className="form-field">
            <label htmlFor="new-description">Description (optional)</label>
            <textarea id="new-description" name="description" rows={2} />
          </div>
          <button type="submit" className="btn btn-primary">Add Event</button>
        </form>
      </div>

      {events.length === 0 ? (
        <div className="info-card">
          <p style={{ marginBottom: 0 }}>No homepage events yet — add one above.</p>
        </div>
      ) : (
        eventsByMonth.map((group) => (
          <div className="event-month-group" key={group.key}>
            <CollapsibleGroup label={`${group.label} (${group.events.length})`}>
              <div className="two-col" style={{ marginBottom: 20 }}>
              {group.events.map((event) => (
                <div className="info-card" key={event.id}>
                  <span
                    className={`badge-pill ${event.visible ? "badge-attendance" : "badge-pending"}`}
                    style={{ marginBottom: 12, display: "inline-block" }}
                  >
                    {event.visible ? "Visible on site" : "Hidden from site"}
                  </span>
                  <form action={updateHomepageEventAction}>
                    <input type="hidden" name="id" value={event.id} />
                    <div className="form-field">
                      <label htmlFor={`title-${event.id}`}>Title</label>
                      <input id={`title-${event.id}`} name="title" required defaultValue={event.title} />
                    </div>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                      <div className="form-field" style={{ flex: 1, minWidth: 160 }}>
                        <label htmlFor={`dateLabel-${event.id}`}>Date Label</label>
                        <input id={`dateLabel-${event.id}`} name="dateLabel" required defaultValue={event.dateLabel} />
                      </div>
                      <div className="form-field" style={{ flex: 1, minWidth: 160 }}>
                        <label htmlFor={`sortDate-${event.id}`}>Sort Date</label>
                        <input
                          id={`sortDate-${event.id}`}
                          name="sortDate"
                          type="date"
                          required
                          defaultValue={toDateInputValue(event.sortDate)}
                        />
                      </div>
                    </div>
                    <div className="form-field">
                      <label htmlFor={`description-${event.id}`}>Description (optional)</label>
                      <textarea
                        id={`description-${event.id}`}
                        name="description"
                        rows={2}
                        defaultValue={event.description ?? ""}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <button type="submit" className="btn btn-primary btn-small">Save</button>
                    </div>
                  </form>
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <form action={toggleHomepageEventVisibilityAction}>
                      <input type="hidden" name="id" value={event.id} />
                      <input type="hidden" name="visible" value={String(event.visible)} />
                      <button
                        type="submit"
                        className="btn btn-outline btn-small"
                        style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
                      >
                        {event.visible ? "Hide from Site" : "Show on Site"}
                      </button>
                    </form>
                    {canDelete && (
                      <form action={deleteHomepageEventAction}>
                        <input type="hidden" name="id" value={event.id} />
                        <button
                          type="submit"
                          className="btn btn-outline btn-small"
                          style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}
                        >
                          Delete
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              ))}
              </div>
            </CollapsibleGroup>
          </div>
        ))
      )}
    </>
  );
}
