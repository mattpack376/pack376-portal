import type { Metadata } from "next";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Den Leaders' Corner — Pack 376",
  description:
    "Meet the pack leadership and den leaders of Pack 376, plus leader resources — rosters, forms, the pack calendar, and links to BSA tools.",
};

const CALENDAR_URL = "https://calendar.pack376nyc.org";

export default function DenLeadersCornerPage() {
  return (
    <>
      <Header />

      <section className="page-hero">
        <div className="eyebrow" style={{ background: "rgba(255,255,255,0.15)", color: "var(--scout-gold)" }}>
          Meet the Team
        </div>
        <h1>Den Leaders&apos; Corner</h1>
        <p>
          Say hello to the volunteers who run the pack — from our key leadership team
          down to each den.
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

          <div className="construction-notice">
            <div className="icon-badge">🚧</div>
            <p>This page is still under construction! Headshots and full bios are coming soon — for now, here&apos;s who&apos;s who.</p>
          </div>

          <div className="section-head center">
            <div className="eyebrow">Pack Leadership</div>
            <h2>Key Leadership</h2>
          </div>
          <div className="exec-grid" style={{ marginBottom: 48 }}>
            <div className="corner-card">
              <div className="corner-card-stripe stripe-exec" />
              <div className="corner-card-body">
                <div className="corner-photo">📷</div>
                <h3>Matt Rosen</h3>
                <div className="corner-role">Committee Chair</div>
                <p className="corner-bio">Matt oversees the pack committee — fundraising, budgeting, and long-term planning for Pack 376.</p>
                <div className="corner-email">Email coming soon</div>
              </div>
            </div>

            <div className="corner-card">
              <div className="corner-card-stripe stripe-exec" />
              <div className="corner-card-body">
                <div className="corner-photo">📷</div>
                <h3>Dianaliz Almonte</h3>
                <div className="corner-role">Treasurer</div>
                <p className="corner-bio">Dianaliz manages pack dues, fundraising proceeds, and day-to-day finances as Treasurer.</p>
                <div className="corner-note">Also the Wolf Den Leader</div>
                <div className="corner-email">Email coming soon</div>
              </div>
            </div>

            <div className="corner-card">
              <div className="corner-card-stripe stripe-exec" />
              <div className="corner-card-body">
                <div className="corner-photo">📷</div>
                <h3>Howell Woods</h3>
                <div className="corner-role">Cubmaster</div>
                <p className="corner-bio">Howell runs pack meetings and leads the overall Cub Scout program as Cubmaster.</p>
                <div className="corner-note">Also the Arrow of Light Den Leader</div>
                <div className="corner-email">Email coming soon</div>
              </div>
            </div>

            <div className="corner-card">
              <div className="corner-card-stripe stripe-exec" />
              <div className="corner-card-body">
                <div className="corner-photo">📷</div>
                <h3>Chris LaRosa</h3>
                <div className="corner-role">Assistant Cubmaster</div>
                <p className="corner-bio">Chris supports the Cubmaster in running pack meetings, events, and campouts.</p>
                <div className="corner-note">Also a Webelos Den Leader</div>
                <div className="corner-email">Email coming soon</div>
              </div>
            </div>
          </div>

          <div className="section-head center">
            <div className="eyebrow">Meet the Dens</div>
            <h2>Den Leaders</h2>
          </div>
          <div className="corner-grid">
            <div className="corner-card">
              <div className="corner-card-stripe rk-lion" />
              <div className="corner-card-body">
                <div className="corner-photo">📷</div>
                <h3>Nicole Scivioli</h3>
                <div className="corner-role">Lion Den Leader</div>
                <p className="corner-bio">Nicole leads our Lions, helping our newest scouts take their very first steps on the Cub Scout trail.</p>
                <div className="corner-email">Email coming soon</div>
              </div>
            </div>

            <div className="corner-card">
              <div className="corner-card-stripe rk-tiger" />
              <div className="corner-card-body">
                <div className="corner-photo">📷</div>
                <h3>Jeanne Drago</h3>
                <div className="corner-role">Tiger Den Leader</div>
                <p className="corner-bio">Jeanne leads our Tigers, guiding scouts through their first hands-on adventures.</p>
                <div className="corner-email">Email coming soon</div>
              </div>
            </div>

            <div className="corner-card">
              <div className="corner-card-stripe rk-wolf" />
              <div className="corner-card-body">
                <div className="corner-photo">📷</div>
                <h3>Dianaliz Almonte</h3>
                <div className="corner-role">Wolf Den Leader</div>
                <p className="corner-bio">Dianaliz leads our Wolves, building teamwork and outdoor skills with our 2nd graders.</p>
                <div className="corner-email">Email coming soon</div>
              </div>
            </div>

            <div className="corner-card">
              <div className="corner-card-stripe rk-bear" />
              <div className="corner-card-body">
                <div className="corner-photo">📷</div>
                <h3>Skylar Moeller</h3>
                <div className="corner-role">Bear Den Leader</div>
                <p className="corner-bio">Skylar leads our Bears, digging into science, cooking, and community adventures with our 3rd graders.</p>
                <div className="corner-email">Email coming soon</div>
              </div>
            </div>

            <div className="corner-card">
              <div className="corner-card-stripe rk-webelos" />
              <div className="corner-card-body">
                <div className="corner-photo">📷</div>
                <h3>Chris LaRosa &amp; Carmine Mancini</h3>
                <div className="corner-role">Webelos Den Leaders</div>
                <p className="corner-bio">Chris and Carmine co-lead our Webelos, preparing scouts for more independent, self-directed adventures.</p>
                <div className="corner-email">Email coming soon</div>
              </div>
            </div>

            <div className="corner-card">
              <div className="corner-card-stripe rk-aol" />
              <div className="corner-card-body">
                <div className="corner-photo">📷</div>
                <h3>Howell Woods</h3>
                <div className="corner-role">Arrow of Light Den Leader</div>
                <p className="corner-bio">Howell leads our Arrow of Light scouts, getting them ready to bridge into Scouts BSA.</p>
                <div className="corner-email">Email coming soon</div>
              </div>
            </div>
          </div>

        </div>
      </section>

      <section style={{ paddingTop: 8, background: "var(--white)" }}>
        <div className="container">
          <div className="section-head center">
            <div className="eyebrow">Behind the Booth</div>
            <h2>Leader Resources</h2>
            <p>
              Everything our den leaders, assistant leaders, and committee members need to run
              a great pack — rosters, forms, and go-to links.
            </p>
          </div>
          <div className="resource-grid">
            <div className="resource-card">
              <div className="icon-badge">💻</div>
              <div>
                <h3>Den Advancement Portal</h3>
                <p>Track your den&apos;s adventure progress online — log in with your den&apos;s account.</p>
                <a className="link" href="https://portal.pack376nyc.org" target="_blank" rel="noopener">Open the portal →</a>
              </div>
            </div>
            <div className="resource-card">
              <div className="icon-badge">🗓️</div>
              <div>
                <h3>Calendar of Events</h3>
                <p>The live 2026–2027 pack calendar — updates to the published document appear automatically.</p>
                <a className="link" href={CALENDAR_URL} target="_blank" rel="noopener">Open Live Calendar →</a>
              </div>
            </div>
            <div className="resource-card">
              <div className="icon-badge">📣</div>
              <div>
                <h3>Recruitment Flyer</h3>
                <p>Share-ready flyer for school events and National Night Out.</p>
                <a className="link" href="/pack-376-recruitment-flyer.jpeg" target="_blank" rel="noopener">Open Recruitment Flyer →</a>
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
