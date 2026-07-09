import type { Metadata } from "next";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Leader Resources — Pack 376",
  description: "Resources for Pack 376 den leaders and committee members: rosters, forms, and links to BSA tools.",
};

export default function LeaderResourcesPage() {
  return (
    <>
      <Header />

      <section className="page-hero">
        <div className="eyebrow" style={{ background: "rgba(255,255,255,0.15)", color: "var(--scout-gold)" }}>
          Behind the Booth
        </div>
        <h1>Leader Resources</h1>
        <p>
          Everything our den leaders, assistant leaders, and committee members need to run
          a great pack — rosters, forms, and go-to links.
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

      <section style={{ paddingTop: 24 }}>
        <div className="container">
          <div className="section-head center">
            <div className="eyebrow">Meet the Team</div>
            <h2>Pack Leadership</h2>
          </div>
          <div className="leader-grid">
            <div className="leader-card">
              <div className="leader-avatar">HW</div>
              <h3>Howell Woods</h3>
              <div className="leader-role">Cubmaster</div>
              <div className="leader-contact"><a href="tel:6467502836">646-750-2836</a></div>
            </div>
            <div className="leader-card">
              <div className="leader-avatar">CL</div>
              <h3>Chris LaRosa</h3>
              <div className="leader-role">Assistant Cubmaster</div>
              <div className="leader-contact"><Link href="/contact">Contact via pack email</Link></div>
            </div>
            <div className="leader-card">
              <div className="leader-avatar">MR</div>
              <h3>Matt Rosen</h3>
              <div className="leader-role">Committee Chair</div>
              <div className="leader-contact"><Link href="/contact">Contact via pack email</Link></div>
            </div>
          </div>
        </div>
      </section>

      <section style={{ background: "var(--white)" }}>
        <div className="container">
          <div className="section-head center">
            <div className="eyebrow">Toolbox</div>
            <h2>Documents &amp; Tools</h2>
            <p>
              Pack-specific files (advancement trackers, calendars, rosters) are shared with
              registered leaders by email / shared drive. Reach out to the Committee Chair if
              you need access.
            </p>
          </div>
          <div className="resource-grid">
            <div className="resource-card">
              <div className="icon-badge">📋</div>
              <div>
                <h3>Advancement Tracker</h3>
                <p>The master spreadsheet tracking every scout&apos;s rank &amp; adventure progress for the year.</p>
                <Link className="link" href="/contact">Request access →</Link>
              </div>
            </div>
            <div className="resource-card">
              <div className="icon-badge">🗓️</div>
              <div>
                <h3>Calendar of Events</h3>
                <p>The full 2026–2027 pack calendar: campouts, pack nights, and one-day events.</p>
                <Link className="link" href="/contact">Request a copy →</Link>
              </div>
            </div>
            <div className="resource-card">
              <div className="icon-badge">📣</div>
              <div>
                <h3>Recruitment Flyer</h3>
                <p>Share-ready flyer for school events and National Night Out.</p>
                <Link className="link" href="/contact">Request a copy →</Link>
              </div>
            </div>
            <div className="resource-card">
              <div className="icon-badge">🦁</div>
              <div>
                <h3>Lion Printable Tracker</h3>
                <p>A kindergarten-friendly rank tracker for Lion den leaders.</p>
                <Link className="link" href="/contact">Request a copy →</Link>
              </div>
            </div>
            <div className="resource-card">
              <div className="icon-badge">📖</div>
              <div>
                <h3>Scoutbook</h3>
                <p>Official BSA advancement &amp; roster tracking tool used by our den leaders.</p>
                <a className="link" href="https://scoutbook.scouting.org/" target="_blank" rel="noopener">Open Scoutbook →</a>
              </div>
            </div>
            <div className="resource-card">
              <div className="icon-badge">🧭</div>
              <div>
                <h3>BSA Program Resources</h3>
                <p>Official Cub Scout program guides, adventure requirements, and leader training.</p>
                <a className="link" href="https://www.scouting.org/programs/cub-scouts/" target="_blank" rel="noopener">Visit scouting.org →</a>
              </div>
            </div>
            <div className="resource-card">
              <div className="icon-badge">💻</div>
              <div>
                <h3>Den Advancement Portal</h3>
                <p>Track your den&apos;s adventure progress online — log in with your den&apos;s account.</p>
                <Link className="link" href="/portal/login">Open the portal →</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="container two-col">
          <div className="info-card">
            <h3 style={{ marginTop: 0 }}>Volunteering</h3>
            <p>Pack 376 runs on parent power. Whether you can help once a year or once a month, there&apos;s a spot for you:</p>
            <ul>
              <li>Den leader or assistant den leader</li>
              <li>Committee member (fundraising, events, communications)</li>
              <li>Pack night &amp; campout setup/cleanup crew</li>
              <li>Popcorn &amp; fundraiser support</li>
            </ul>
            <Link className="btn btn-red" href="/contact" style={{ marginTop: 8 }}>I Want to Help</Link>
          </div>
          <div className="info-card">
            <h3 style={{ marginTop: 0 }}>Leader Meetings</h3>
            <p>Den leaders and committee members meet on their own schedules to plan pack nights, campouts, and fundraisers.</p>
            <ul>
              <li>Den Leaders &amp; Assistant Den Leaders — Weekly, Fridays 7–10 PM</li>
              <li>Committee Members — Bi-Monthly, Virtually</li>
            </ul>
            <p className="form-note">Exact dates are posted on the pack calendar and shared with registered leaders.</p>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
