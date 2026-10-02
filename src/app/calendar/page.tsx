import type { Metadata } from "next";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import CalendarView from "@/components/CalendarView";
import { getPublicCalendar } from "@/lib/calendarEventsData";
import { shortDate } from "@/lib/calendarData";
import { todayDateOnlyString } from "@/lib/dateOnly";

// Edits in the portal revalidate this page straight away. This is for the
// part nothing edits: "past" dimming, collapsed months and the Next Up card
// all key off today's date, which no admin action fires when it rolls over —
// same reasoning as the homepage.
export const revalidate = 300;

// DRAFT: hidden from search engines, and not yet linked from the header nav,
// sitemap.ts, or the Activities page. When this replaces the Google Doc calendar,
// drop the `robots` line and wire those up (see the Header's "Calendar" item).
export const metadata: Metadata = {
  title: "Calendar of Events — Pack 376",
  description:
    "Pack 376's calendar: campouts, pack nights, derbies, fundraisers, and every date to put on the fridge.",
  robots: { index: false, follow: false },
};

const GLANCE_ICON = { camping: "⛺", "pack-night": "🎟️", "one-day": "☀️", fundraiser: "💵" } as const;

type DateChip = { key: string; label: string; month: string; past: boolean };

/** A Year at a Glance card that lists plain dates as chips: Scout Meetings, Scout Sundays, No Meetings. */
function DateCard({
  category,
  icon,
  title,
  note,
  chips,
  wide,
}: {
  category: string;
  icon: string;
  title: string;
  note?: string;
  chips: DateChip[];
  wide?: boolean;
}) {
  return (
    <div className={`booth-card cal-glance cal-cat--${category}${wide ? " cal-glance--wide" : ""}`}>
      <div className="cal-glance-head">
        <div className="icon-badge">{icon}</div>
        <div>
          <h3>{title}</h3>
          {note && <p>{note}</p>}
        </div>
      </div>
      <ul className="cal-date-chips">
        {chips.map((c) => (
          <li key={c.key} className={c.past ? "is-past" : undefined}>
            <a href={`#month-${c.month}`}>{c.label}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The reason a night has no meeting, from how the title is worded: "Black
 * Friday — No Meeting" -> "Black Friday", "No Scout Meeting - Camp Conron" ->
 * "Camp Conron". A bare "No Meeting" has no reason to add. The card is already
 * headed "No Meetings", so the repeated words only get in the way.
 */
function noMeetingReason(title: string) {
  return title
    .replace(/\s*[—–-]\s*No (Scout )?Meeting\s*$/i, "")
    .replace(/^No (Scout )?Meeting\s*[—–:-]\s*/i, "")
    .replace(/^No (Scout )?Meeting$/i, "")
    .trim();
}

export default async function CalendarPage() {
  const today = todayDateOnlyString();
  const { yearLabel, events, months, glance } = await getPublicCalendar(today);
  // The three date-list cards are derived from the events, not hand-listed like
  // the other glance cards, so they can't drift from the month list below.
  const chipFor = (e: (typeof events)[number], label = shortDate(e.date)): DateChip => ({
    key: `${e.date}-${e.title}`,
    label,
    month: e.date.slice(0, 7),
    past: e.date < today,
  });
  const meetingEvents = events.filter((e) => e.category === "meeting");
  const scoutSundays = events.filter((e) => e.category === "scout-sunday").map((e) => chipFor(e));
  const noMeetings = events
    .filter((e) => e.noMeeting)
    .map((e) => {
      const reason = noMeetingReason(e.title);
      return chipFor(e, reason ? `${shortDate(e.date)} · ${reason}` : shortDate(e.date));
    });
  const meetings = meetingEvents.map((e) => chipFor(e));

  return (
    <>
      <Header />

      <section className="page-hero">
        <h1>{yearLabel} Calendar of Events</h1>
        <p className="cal-hero-note">All dates and events are subject to change or cancellation.</p>
      </section>
      <div className="wave-divider" style={{ marginTop: -1 }}>
        <svg viewBox="0 0 1200 70" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M0,40 C150,90 350,0 600,30 C850,60 1050,0 1200,40 L1200,70 L0,70 Z"
            fill="var(--cream)"
            style={{ transform: "scaleY(-1)", transformOrigin: "center" }}
          />
        </svg>
      </div>

      {events.length === 0 ? (
        <section style={{ paddingTop: 16 }}>
          <div className="container">
            <div className="info-card" style={{ textAlign: "center" }}>
              <h3 style={{ marginTop: 0 }}>The {yearLabel} calendar is coming soon</h3>
              <p>Check back shortly, or get in touch and we&apos;ll tell you what&apos;s planned.</p>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section style={{ paddingTop: 16 }}>
            <div className="container">
              <div className="section-head center">
                <div className="eyebrow">Don&apos;t Miss These</div>
                <h2>Year at a Glance</h2>
              </div>
              <div className="card-grid">
                {glance.map((group) => (
                  <div className={`booth-card cal-glance cal-cat--${group.category}`} key={group.category}>
                    <div className="icon-badge">{GLANCE_ICON[group.category]}</div>
                    <h3>{group.title}</h3>
                    <ul>
                      {group.items.map((item) => (
                        <li key={`${item.label}-${item.when}`}>
                          {item.month ? <a href={`#month-${item.month}`}>{item.label}</a> : <span>{item.label}</span>}
                          <b>{item.when}</b>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {meetings.length > 0 && (
                  <DateCard
                    wide
                    category="meeting"
                    icon="🕢"
                    title="Scout Meetings"
                    note={`Fridays${meetingEvents[0].detail ? ` · ${meetingEvents[0].detail}` : ""}`}
                    chips={meetings}
                  />
                )}
                {(scoutSundays.length > 0 || noMeetings.length > 0) && (
                  <div className="cal-glance-pair">
                    {scoutSundays.length > 0 && (
                      <DateCard category="scout-sunday" icon="⛪" title="Scout Sundays" note="10 AM Mass" chips={scoutSundays} />
                    )}
                    {noMeetings.length > 0 && (
                      <DateCard category="no-meeting" icon="🚫" title="No Meetings" note="No scout meeting these days" chips={noMeetings} />
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section style={{ background: "var(--white)" }}>
            <div className="container">
              <CalendarView events={events} months={months} today={today} />
            </div>
          </section>
        </>
      )}

      <section className="cta-banner section-tight">
        <h2>Questions About an Event?</h2>
        <p>Dates and details can shift. Reach out and we&apos;ll point you to the latest.</p>
        <div className="hero-actions" style={{ justifyContent: "center", marginTop: 20 }}>
          <Link className="btn btn-primary" href="/contact">Get In Touch</Link>
        </div>
      </section>

      <Footer />
    </>
  );
}
