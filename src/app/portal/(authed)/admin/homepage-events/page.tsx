import { requireHomepageContentSession } from "@/lib/authorize";
import { getAllHomepageEvents } from "@/lib/homepageEventsData";
import { getAllSiteBanners } from "@/lib/siteBannerData";
import {
  createHomepageEventAction,
  updateHomepageEventAction,
  deleteHomepageEventAction,
} from "@/lib/actions/homepageEvents";
import {
  createSiteBannerAction,
  toggleSiteBannerAction,
  deleteSiteBannerAction,
} from "@/lib/actions/siteBanner";

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default async function HomepageEventsAdminPage() {
  await requireHomepageContentSession();
  const [events, banners] = await Promise.all([getAllHomepageEvents(), getAllSiteBanners()]);

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
          A short, urgent notice in a black bar with yellow text, shown just below the header. Only the most recent
          &quot;on&quot; banner shows — post a new one to replace the current message, or turn it off to
          clear it without losing the text.
        </p>
        <form action={createSiteBannerAction} style={{ marginBottom: banners.length > 0 ? 20 : 0 }}>
          <div className="form-field">
            <label htmlFor="new-banner-message">Message</label>
            <input id="new-banner-message" name="message" required placeholder="e.g. Meeting cancelled this Friday due to weather" />
          </div>
          <button type="submit" className="btn btn-primary">Post Banner</button>
        </form>

        {banners.map((banner) => (
          <div
            key={banner.id}
            style={{ background: "var(--cream)", borderRadius: 8, padding: "10px 14px", marginBottom: 8 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
              <p style={{ marginBottom: 0, fontWeight: 700 }}>
                {banner.message}{" "}
                <span className={`badge-pill ${banner.active ? "badge-attendance" : "badge-pending"}`}>
                  {banner.active ? "On" : "Off"}
                </span>
              </p>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <form action={toggleSiteBannerAction}>
                  <input type="hidden" name="id" value={banner.id} />
                  <input type="hidden" name="active" value={String(banner.active)} />
                  <button type="submit" className="btn btn-outline btn-small" style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}>
                    Turn {banner.active ? "Off" : "On"}
                  </button>
                </form>
                <form action={deleteSiteBannerAction}>
                  <input type="hidden" name="id" value={banner.id} />
                  <button type="submit" className="btn btn-outline btn-small" style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}>
                    Delete
                  </button>
                </form>
              </div>
            </div>
          </div>
        ))}
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
        events.map((event) => (
          <div className="info-card" key={event.id} style={{ maxWidth: 480, marginBottom: 20 }}>
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
            <form action={deleteHomepageEventAction} style={{ marginTop: 10 }}>
              <input type="hidden" name="id" value={event.id} />
              <button
                type="submit"
                className="btn btn-outline btn-small"
                style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}
              >
                Delete
              </button>
            </form>
          </div>
        ))
      )}
    </>
  );
}
