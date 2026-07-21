import type { Metadata } from "next";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Activities — Intro to Scouting — Pack 376",
  description:
    "Camping, hiking, the Pinewood Derby, day trips, and sports outings — see the variety of adventures Pack 376 Cub Scouts experience all year.",
};

const ACTIVITIES = [
  {
    icon: "⛺",
    name: "Camping",
    blurb:
      "Multi-day campouts throughout the year — Camp Conron, Camp Pouch, Camp Alpine, and a Memorial Day weekend trip. Scouts pitch tents, cook over a fire, and earn outdoor adventure requirements together as a pack.",
  },
  {
    icon: "🥾",
    name: "Hiking",
    blurb:
      "Trail hikes build endurance and outdoor know-how, from short den nature walks to longer treks that count toward rank requirements like Webelos' two-mile hike.",
  },
  {
    icon: "🏎️",
    name: "Pinewood Derby",
    blurb:
      "Scouts design, carve, and race their own wooden cars down a gravity track — a pack tradition and one of the most anticipated events of the year, capped off with an overnight at the hall.",
  },
  {
    icon: "🚌",
    name: "Day Trips",
    blurb:
      "Museums, farms, tours, and other local outings give scouts a taste of Brooklyn and beyond, usually wrapped into a single afternoon so the whole family can join.",
  },
  {
    icon: "⚽",
    name: "Sports Outings",
    blurb:
      "From bowling nights to ballgames, sports outings mix teamwork and fun — a lower-key way for scouts and families to hang out together outside of regular meetings.",
  },
];

export default function ActivitiesPage() {
  return (
    <>
      <Header />

      <section className="page-hero">
        <div className="eyebrow" style={{ background: "rgba(255,255,255,0.15)", color: "var(--scout-gold)" }}>
          <Link href="/intro-to-scouting" style={{ color: "inherit" }}>← Intro to Scouting</Link> · The Fun Part
        </div>
        <h1>Activities</h1>
        <p>
          Cub Scouting isn&apos;t just meetings — it&apos;s campouts, derbies, hikes, and trips
          that scouts talk about all year. Here&apos;s a look at what Pack 376 gets up to.
        </p>
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
          <div className="card-grid">
            {ACTIVITIES.map((a) => (
              <div className="booth-card" key={a.name}>
                <div className="icon-badge">{a.icon}</div>
                <h3>{a.name}</h3>
                <p style={{ fontSize: 14.5, color: "var(--ink-soft)" }}>{a.blurb}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ background: "var(--white)" }}>
        <div className="container">
          <div className="info-card" style={{ textAlign: "center" }}>
            <h3 style={{ marginTop: 0 }}>See It for Yourself</h3>
            <p>
              Browse photos from recent campouts, derbies, and pack nights, or check the calendar
              for what&apos;s coming up next.
            </p>
            <div className="hero-actions" style={{ justifyContent: "center" }}>
              <Link className="btn btn-primary" href="/gallery">View Photo Albums</Link>
              <Link className="btn btn-outline" href="/parent-resources">See the Calendar</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="cta-banner section-tight">
        <h2>All Families Welcome</h2>
        <p>Boys and girls, kindergarten through 5th grade — join anytime, no experience needed.</p>
        <div className="hero-actions" style={{ justifyContent: "center", marginTop: 20 }}>
          <Link className="btn btn-primary" href="/contact">Get In Touch</Link>
        </div>
      </section>

      <Footer />
    </>
  );
}
