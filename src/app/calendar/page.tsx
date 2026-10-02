import type { Metadata } from "next";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import CalendarView from "@/components/CalendarView";
import { CALENDAR_EVENTS, YEAR_AT_A_GLANCE } from "@/lib/calendarData";
import { todayDateOnlyString } from "@/lib/dateOnly";

// "Past" dimming and the Next Up card key off today's date, which nothing
// republishes when the date rolls over — same reasoning as the homepage.
export const revalidate = 300;

// DRAFT: hidden from search engines, and not yet linked from the header nav,
// sitemap.ts, or the Activities page. When this replaces the Google Doc calendar,
// drop the `robots` line and wire those up (see the Header's "Calendar" item).
export const metadata: Metadata = {
  title: "Calendar of Events — Pack 376",
  description:
    "Pack 376's 2026–2027 calendar: campouts, pack nights, derbies, fundraisers, and every date to put on the fridge.",
  robots: { index: false, follow: false },
};

const GLANCE_ICON = { camping: "⛺", "pack-night": "🎟️", "one-day": "☀️" } as const;

export default function CalendarPage() {
  const today = todayDateOnlyString();

  return (
    <>
      <Header />

      <section className="page-hero">
        <div className="eyebrow" style={{ background: "rgba(255,255,255,0.15)", color: "var(--scout-gold)" }}>
          Mark Your Calendar
        </div>
        <h1>2026–2027 Calendar of Events</h1>
        <p>
          Welcome to Pack 376! We&apos;re excited for another great year of Cub Scout adventure. Here&apos;s
          our full calendar of pack-wide events, campouts, and activities.
        </p>
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

      <section style={{ paddingTop: 16 }}>
        <div className="container">
          <div className="section-head center">
            <div className="eyebrow">Don&apos;t Miss These</div>
            <h2>Year at a Glance</h2>
          </div>
          <div className="card-grid">
            {YEAR_AT_A_GLANCE.map((group) => (
              <div className={`booth-card cal-glance cal-cat--${group.category}`} key={group.category}>
                <div className="icon-badge">{GLANCE_ICON[group.category]}</div>
                <h3>{group.title}</h3>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.label}>
                      {item.month ? <a href={`#month-${item.month}`}>{item.label}</a> : <span>{item.label}</span>}
                      <b>{item.when}</b>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ background: "var(--white)" }}>
        <div className="container">
          <CalendarView events={CALENDAR_EVENTS} today={today} />
        </div>
      </section>

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
