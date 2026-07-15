import type { Metadata } from "next";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Volunteer With Us — Pack 376",
  description:
    "Pack 376 runs on parent volunteers — and you don't have to be a weekly den leader to help. See the roles available and volunteer today.",
};

const VOLUNTEER_TO = "pack376.brooklyn@gmail.com";
const VOLUNTEER_CC = "matt.pack376@gmail.com";
const VOLUNTEER_SUBJECT = encodeURIComponent("I'd like to volunteer with Pack 376");
const VOLUNTEER_BODY = encodeURIComponent(
  ["Hi Pack 376,", "", "I'd like to help out. A role I'm interested in:", "", "My name:", "My scout's name / den:", "My email / phone:"].join("\n")
);
const VOLUNTEER_MAILTO = `mailto:${VOLUNTEER_TO}?cc=${VOLUNTEER_CC}&subject=${VOLUNTEER_SUBJECT}&body=${VOLUNTEER_BODY}`;

const ROLES = [
  {
    icon: "🗂️",
    name: "Committee Member",
    blurb: "Join the pack committee to help with planning, budgeting, and big-picture decisions — meets far less often than a weekly den.",
  },
  {
    icon: "🎉",
    name: "Activities Coordinator",
    blurb: "Help plan and organize pack nights, campouts, and outings — from picking a date to lining up supplies.",
  },
  {
    icon: "💰",
    name: "Fundraising Helper",
    blurb: "Support fundraisers like the bake sale or raffle — a few hours here and there keeps dues affordable for every family.",
  },
  {
    icon: "🏅",
    name: "Advancement Coordinator",
    blurb: "Help track adventure progress and rank advancement across the pack, and keep den leaders stocked with what they need.",
  },
  {
    icon: "🙋",
    name: "Event Volunteer",
    blurb: "Show up and lend a hand at a single event — set up, check-in, supervise a station, or clean up. No ongoing commitment required.",
  },
  {
    icon: "📸",
    name: "Photographer / Social Media Helper",
    blurb: "Snap photos at meetings and events, or help share pack news and highlights on Instagram.",
  },
  {
    icon: "🚗",
    name: "Camping & Transportation Helper",
    blurb: "Help haul gear to campouts, drive carpools, or lend a hand setting up camp for the weekend.",
  },
];

export default function VolunteerPage() {
  return (
    <>
      <Header />

      <section className="page-hero">
        <div className="eyebrow" style={{ background: "rgba(255,255,255,0.15)", color: "var(--scout-gold)" }}>
          Pack 376 Runs on Volunteers
        </div>
        <h1>Volunteer With Us</h1>
        <p>
          You don&apos;t have to become a weekly den leader to make a big difference. Pack 376
          has roles for every schedule and skill set.
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
          <div className="info-card" style={{ borderLeft: "8px solid var(--scout-gold)", marginBottom: 40 }}>
            <div className="eyebrow">No Weekly Commitment Needed</div>
            <h2 style={{ marginBottom: 8 }}>Every Bit of Help Counts</h2>
            <p>
              Pack 376 is entirely parent-run, but running a den every week isn&apos;t the only
              way to help. Many of our roles take just a few hours a month — or even just showing
              up for a single event. Pick whatever fits your schedule.
            </p>
            <a className="btn btn-primary" href={VOLUNTEER_MAILTO}>
              Volunteer With Us
            </a>
          </div>

          <div className="section-head">
            <div className="eyebrow">Ways to Help</div>
            <h2>Volunteer Roles</h2>
            <p>Not sure which fits? Reach out and we&apos;ll help you find the right one.</p>
          </div>
          <div className="resource-grid" style={{ marginBottom: 40 }}>
            {ROLES.map((role) => (
              <div className="resource-card" key={role.name}>
                <div className="icon-badge">{role.icon}</div>
                <div>
                  <h3>{role.name}</h3>
                  <p>{role.blurb}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cta-banner">
        <h2>Ready to Pitch In?</h2>
        <p>Send us a note with your name, your scout&apos;s den, and what you&apos;re interested in — we&apos;ll take it from there.</p>
        <div className="hero-actions" style={{ justifyContent: "center", marginTop: 24 }}>
          <a className="btn btn-primary" href={VOLUNTEER_MAILTO}>Volunteer With Us</a>
          <Link className="btn btn-outline" href="/contact">Contact Us Instead</Link>
        </div>
      </section>

      <Footer />
    </>
  );
}
