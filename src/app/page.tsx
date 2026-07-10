import Image from "next/image";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const JOIN_URL = "https://my.scouting.org/VES/OnlineReg/1.0.0/?tu=UF-MB-640paa3376";

export default function HomePage() {
  return (
    <>
      <Header />

      <section className="hero">
        <div className="hero-grid">
          <div>
            <Image
              className="hero-logo"
              src="/cub-scout-emblem.png"
              alt="Cub Scouts rank emblem — Bobcat, Tiger Cub, Wolf, Bear, and Webelos"
              width={116}
              height={116}
            />
            <div className="hero-ticket">🎟️ Admit One Family — Open House Anytime</div>
            <h1>
              You Belong <span className="hi">In Scouts</span>
            </h1>
            <p className="lead">
              Pack 376 brings the boardwalk to Cub Scouting — real adventures, lifelong
              skills, and a pack family that feels like Brooklyn. Open to all families,
              kindergarten through 5th grade.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href={JOIN_URL} target="_blank" rel="noopener">Join Pack 376</a>
              <Link className="btn btn-outline" href="/rank-requirements">See Rank Requirements</Link>
            </div>
          </div>
          <div className="hero-art">
            <svg viewBox="0 0 380 380" xmlns="http://www.w3.org/2000/svg">
              <circle cx="190" cy="190" r="150" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="10" />
              <circle cx="190" cy="190" r="150" fill="none" stroke="var(--scout-gold)" strokeWidth="4" strokeDasharray="4 10" />
              <g stroke="rgba(255,255,255,0.4)" strokeWidth="3">
                <line x1="190" y1="190" x2="190" y2="40" />
                <line x1="190" y1="190" x2="190" y2="340" />
                <line x1="190" y1="190" x2="40" y2="190" />
                <line x1="190" y1="190" x2="340" y2="190" />
                <line x1="190" y1="190" x2="84" y2="84" />
                <line x1="190" y1="190" x2="296" y2="84" />
                <line x1="190" y1="190" x2="84" y2="296" />
                <line x1="190" y1="190" x2="296" y2="296" />
              </g>
              <circle cx="190" cy="190" r="20" fill="var(--scout-gold)" />
              <path d="M190 178 L194 187 L204 188 L196.5 194.5 L199 204 L190 199 L181 204 L183.5 194.5 L176 188 L186 187 Z" fill="var(--scout-blue-dark)" />
              <g>
                <circle cx="190" cy="40" r="16" fill="var(--carnival-red)" />
                <circle cx="190" cy="340" r="16" fill="var(--teal)" />
                <circle cx="40" cy="190" r="16" fill="var(--scout-gold)" />
                <circle cx="340" cy="190" r="16" fill="var(--carnival-red)" />
                <circle cx="84" cy="84" r="16" fill="var(--teal)" />
                <circle cx="296" cy="84" r="16" fill="var(--scout-gold)" />
                <circle cx="84" cy="296" r="16" fill="var(--carnival-red)" />
                <circle cx="296" cy="296" r="16" fill="var(--teal)" />
              </g>
              <rect x="176" y="330" width="28" height="40" rx="4" fill="rgba(255,255,255,0.3)" />
            </svg>
          </div>
        </div>
        <div className="wave-divider">
          <svg viewBox="0 0 1200 70" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0,40 C150,90 350,0 600,30 C850,60 1050,0 1200,40 L1200,70 L0,70 Z" fill="var(--cream)" />
          </svg>
        </div>
      </section>

      <div className="fact-bar-wrap">
        <div className="fact-bar">
          <span>📍 Veltri Hall, Our Lady of Grace — 430 Avenue W, Brooklyn, NY</span>
          <span className="dot">•</span>
          <span>🗓️ Weekly Meetings — Fridays, 7:00–9:30 PM</span>
        </div>
      </div>

      <section>
        <div className="container">
          <div className="section-head center">
            <div className="eyebrow">Step Right Up</div>
            <h2>What Pack 376 Is All About</h2>
          </div>
          <div className="card-grid">
            <div className="booth-card">
              <div className="icon-badge">🎢</div>
              <h3>What We Do</h3>
              <ul>
                <li>Real adventures &amp; campouts</li>
                <li>Pack nights every month</li>
                <li>Field trips &amp; holiday events</li>
              </ul>
            </div>
            <div className="booth-card">
              <div className="icon-badge">🧭</div>
              <h3>What You Learn</h3>
              <ul>
                <li>Skills for life</li>
                <li>Fundraising &amp; teamwork</li>
                <li>Community service projects</li>
              </ul>
            </div>
            <div className="booth-card">
              <div className="icon-badge">🌟</div>
              <h3>Who You Become</h3>
              <ul>
                <li>Confident, outdoors-ready</li>
                <li>A friend to nature &amp; neighbors</li>
                <li>Part of a lifelong pack family</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section style={{ background: "var(--white)" }}>
        <div className="container">
          <div className="section-head center">
            <div className="eyebrow">The Ride Line-Up</div>
            <h2>Ranks, Kindergarten to 5th Grade</h2>
            <p>Every scout climbs the ladder one rank at a time. Tap Rank Requirements for the full breakdown.</p>
          </div>
          <div className="rank-ladder">
            <Link className="rank-badge-card" href="/rank-requirements">
              <div className="rank-star rk-lion">LION</div>
              <div className="rank-name">Lion</div>
              <div className="rank-grade">Kindergarten</div>
            </Link>
            <Link className="rank-badge-card" href="/rank-requirements">
              <div className="rank-star rk-tiger">TIGER</div>
              <div className="rank-name">Tiger</div>
              <div className="rank-grade">1st Grade</div>
            </Link>
            <Link className="rank-badge-card" href="/rank-requirements">
              <div className="rank-star rk-wolf">WOLF</div>
              <div className="rank-name">Wolf</div>
              <div className="rank-grade">2nd Grade</div>
            </Link>
            <Link className="rank-badge-card" href="/rank-requirements">
              <div className="rank-star rk-bear">BEAR</div>
              <div className="rank-name">Bear</div>
              <div className="rank-grade">3rd Grade</div>
            </Link>
            <Link className="rank-badge-card" href="/rank-requirements">
              <div className="rank-star rk-webelos">WEB</div>
              <div className="rank-name">Webelos</div>
              <div className="rank-grade">4th Grade</div>
            </Link>
            <Link className="rank-badge-card" href="/rank-requirements">
              <div className="rank-star rk-aol">AOL</div>
              <div className="rank-name">Arrow of Light</div>
              <div className="rank-grade">5th Grade</div>
            </Link>
          </div>
        </div>
      </section>

      <section>
        <div className="container">
          <div className="section-head center">
            <div className="eyebrow">Save the Date</div>
            <h2>Upcoming Attractions</h2>
            <p>A few highlights from our 2026–2027 calendar — see the full schedule at a pack meeting.</p>
          </div>
          <div className="event-list" style={{ gridTemplateColumns: "repeat(2, 1fr)", display: "grid" }}>
            <div className="event-ticket">
              <div className="event-date"><span className="month">Oct</span><span className="day">30</span></div>
              <div className="event-body"><h4>Pack Halloween Party</h4><p>Costumes, games, and trick-or-treating with the whole pack.</p></div>
            </div>
            <div className="event-ticket">
              <div className="event-date"><span className="month">Jan</span><span className="day">31</span></div>
              <div className="event-body"><h4>Klondike Derby — Coney Island</h4><p>Our own backyard boardwalk hosts this pack favorite.</p></div>
            </div>
            <div className="event-ticket">
              <div className="event-date"><span className="month">Mar</span><span className="day">5–6</span></div>
              <div className="event-body"><h4>Pinewood Derby + Lock-In</h4><p>Build, race, and stay overnight at Veltri Hall.</p></div>
            </div>
            <div className="event-ticket">
              <div className="event-date"><span className="month">Jun</span><span className="day">18</span></div>
              <div className="event-body"><h4>Graduation Night</h4><p>Our Crossing-Over Ceremony celebrating a year of adventure.</p></div>
            </div>
          </div>
        </div>
      </section>

      <section style={{ background: "var(--white)" }}>
        <div className="container">
          <div className="section-head center">
            <div className="eyebrow">Meet the Team</div>
            <h2>Pack 376 Leadership</h2>
          </div>
          <div className="leader-grid">
            <div className="leader-card">
              <div className="leader-avatar">HW</div>
              <h3>Howell Woods</h3>
              <div className="leader-role">Cubmaster</div>
            </div>
            <div className="leader-card">
              <div className="leader-avatar">CL</div>
              <h3>Chris LaRosa</h3>
              <div className="leader-role">Assistant Cubmaster</div>
            </div>
            <div className="leader-card">
              <div className="leader-avatar">MR</div>
              <h3>Matt Rosen</h3>
              <div className="leader-role">Committee Chair</div>
            </div>
          </div>
        </div>
      </section>

      <section className="cta-banner">
        <h2>We&apos;d Love to Meet You</h2>
        <p>
          Visit us at any weekly Friday meeting or monthly pack night event, join anytime.
          Open to all families — no experience needed, new scouts welcome all year long.
        </p>
        <div className="hero-actions" style={{ justifyContent: "center", marginTop: 24 }}>
          <Link className="btn btn-primary" href="/contact">Get In Touch</Link>
          <Link className="btn btn-outline" href="/leader-resources">Leader Resources</Link>
        </div>
      </section>

      <Footer />
    </>
  );
}
