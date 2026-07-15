import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Parent Resources — Pack 376",
  description: "Pack 376 calendars, parent guides, and family resources for Cub Scout families in Brooklyn, NY.",
};

const CALENDAR_URL =
  "https://docs.google.com/document/d/e/2PACX-1vTt7ZYfxypgB9-HXM7inLi7vznfwXyszYWvKKrSrPmCPfoa1CJzaxnBweqPetUUuC7Bz6J7KeItwDc9/pub";

const PARENT_GUIDES = [
  { grade: "Kindergarten", name: "Lion", icon: "🦁", file: "lion-parent-guide-2026-2027.pdf", blurb: "For our youngest Scouts — a parent or adult partner joins every den meeting and outing." },
  { grade: "1st Grade", name: "Tiger", icon: "🐯", file: "tiger-parent-guide-2026-2027.pdf", blurb: "Teamwork, outdoor basics, healthy habits, and family participation throughout the year." },
  { grade: "2nd Grade", name: "Wolf", icon: "🐺", file: "wolf-parent-guide-2026-2027.pdf", blurb: "More independence, outdoor skills, citizenship, safety, and items completed at home." },
  { grade: "3rd Grade", name: "Bear", icon: "🐻", file: "bear-parent-guide-2026-2027.pdf", blurb: "Longer walks, increased responsibility, practical skills, citizenship, and optional pocketknife work." },
  { grade: "4th Grade", name: "Webelos", icon: "🧭", file: "webelos-parent-guide-2026-2027.pdf", blurb: "A more independent year featuring a two-mile walk, first aid, and prep for Arrow of Light." },
  { grade: "5th Grade", name: "Arrow of Light", icon: "🏹", file: "arrow-of-light-parent-guide-2026-2027.pdf", blurb: "The final Cub Scout year: an overnight campout, service, first aid, and prep for Scouts BSA." },
];

export default function ParentResourcesPage() {
  return (
    <>
      <Header />

      <section className="page-hero">
        <div className="eyebrow" style={{ background: "rgba(255,255,255,0.15)", color: "var(--scout-gold)" }}>
          For Pack Families
        </div>
        <h1>Parent Resources</h1>
        <p>
          Quick access to the pack calendar, recruitment materials, and grade-specific guides
          that explain what your scout will work on throughout the year.
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
          <div className="info-card" style={{ borderLeft: "8px solid var(--teal)", marginBottom: 24 }}>
            <div className="eyebrow">For Registered Families</div>
            <h2 style={{ marginBottom: 8 }}>Parent Portal</h2>
            <p>
              Sign in to see your scout&apos;s next meeting, upcoming deadlines, dues balance, forms that
              need your signature, and pack announcements.
            </p>
            <a className="btn btn-primary" href="/portal/login" target="_blank" rel="noopener">
              Sign In to the Parent Portal
            </a>
          </div>

          <div className="info-card" style={{ borderLeft: "8px solid var(--scout-gold)", marginBottom: 40 }}>
            <div className="eyebrow">Start Here</div>
            <h2 style={{ marginBottom: 8 }}>Calendar of Events</h2>
            <p>
              View the live Pack 376 calendar for the 2026–2027 scouting year — updates made to the
              published document appear automatically.
            </p>
            <a className="btn btn-primary" href={CALENDAR_URL} target="_blank" rel="noopener">
              Open Live Calendar
            </a>
          </div>

          <div className="section-head">
            <div className="eyebrow">Share Pack 376</div>
            <h2>Recruitment Flyer</h2>
            <p>Share our current recruitment flyer with families, schools, and community organizations.</p>
          </div>
          <div className="resource-grid" style={{ marginBottom: 40 }}>
            <div className="resource-card">
              <div className="icon-badge">📣</div>
              <div>
                <h3>Pack 376 Recruitment Flyer</h3>
                <p>Open the full-size flyer for viewing, downloading, printing, or sharing.</p>
                <a className="link" href="/pack-376-recruitment-flyer.jpeg" target="_blank" rel="noopener">
                  Open Recruitment Flyer →
                </a>
              </div>
            </div>
          </div>

          <div className="section-head">
            <div className="eyebrow">Know What to Expect</div>
            <h2>Den Parent Guides by Rank</h2>
            <p>
              Each guide explains required adventures, electives, parent involvement, at-home items,
              and major commitments for the 2026–2027 scouting year.
            </p>
          </div>
          <div className="resource-grid">
            {PARENT_GUIDES.map((guide) => (
              <div className="resource-card" key={guide.name}>
                <div className="icon-badge">{guide.icon}</div>
                <div>
                  <h3>{guide.name} Parent Guide</h3>
                  <p className="form-note" style={{ marginBottom: 6 }}>{guide.grade.toUpperCase()}</p>
                  <p>{guide.blurb}</p>
                  <a className="link" href={`/parent-resources/${guide.file}`} target="_blank" rel="noopener">
                    Open {guide.name} Guide →
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
