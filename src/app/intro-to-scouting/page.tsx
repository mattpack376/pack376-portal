import type { Metadata } from "next";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Intro to Scouting — Pack 376",
  description:
    "New to Cub Scouts? Learn the Scout Oath, Scout Law, Cub Scout Motto, Scout sign, salute, and handshake, and the Outdoor Code.",
};

const SCOUT_LAW = [
  { trait: "Trustworthy", blurb: "Tell the truth and keep your word." },
  { trait: "Loyal", blurb: "Stick by your family, friends, and country." },
  { trait: "Helpful", blurb: "Do things for others without being asked." },
  { trait: "Friendly", blurb: "Be a friend to everyone, even people you just met." },
  { trait: "Courteous", blurb: "Be polite and mind your manners." },
  { trait: "Kind", blurb: "Treat others — and animals — with care." },
  { trait: "Obedient", blurb: "Follow the rules of your family, school, and pack." },
  { trait: "Cheerful", blurb: "Look for the sunny side of things." },
  { trait: "Thrifty", blurb: "Take care of your things and the environment." },
  { trait: "Brave", blurb: "Do the right thing even when it's hard." },
  { trait: "Clean", blurb: "Keep your body and your language clean." },
  { trait: "Reverent", blurb: "Be respectful in your faith and beliefs." },
];

export default function IntroToScoutingPage() {
  return (
    <>
      <Header />

      <section className="page-hero">
        <div className="eyebrow" style={{ background: "rgba(255,255,255,0.15)", color: "var(--scout-gold)" }}>
          New to Pack 376?
        </div>
        <h1>Intro to Scouting</h1>
        <p>
          A quick, family-friendly guide to the words and traditions every Cub Scout learns —
          great for new scouts and the parents cheering them on.
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
        <div className="container" style={{ maxWidth: 880 }}>
          <div className="info-card" style={{ borderLeft: "8px solid var(--scout-gold)", marginBottom: 32 }}>
            <div className="eyebrow">Say It Together</div>
            <h2 style={{ marginBottom: 12 }}>The Scout Oath</h2>
            <p style={{ fontSize: 17, fontStyle: "italic", lineHeight: 1.7 }}>
              &ldquo;On my honor I will do my best to do my duty to God and my country and to
              obey the Scout Law; to help other people at all times; to keep myself physically
              strong, mentally awake, and morally straight.&rdquo;
            </p>
          </div>

          <div className="section-head">
            <div className="eyebrow">Twelve Points</div>
            <h2>The Scout Law</h2>
            <p>A Scout is Trustworthy, Loyal, Helpful, Friendly, Courteous, Kind, Obedient, Cheerful, Thrifty, Brave, Clean, and Reverent.</p>
          </div>
          <div className="resource-grid" style={{ marginBottom: 40 }}>
            {SCOUT_LAW.map((item, i) => (
              <div className="resource-card" key={item.trait}>
                <div className="icon-badge">{i + 1}</div>
                <div>
                  <h3>{item.trait}</h3>
                  <p>{item.blurb}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="info-card" style={{ textAlign: "center", marginBottom: 32 }}>
            <div className="eyebrow">Every Scout Knows It</div>
            <h2 style={{ marginBottom: 8 }}>Cub Scout Motto</h2>
            <p style={{ fontSize: 22, fontFamily: "var(--font-display)", fontWeight: 800, color: "var(--scout-blue-dark)" }}>
              &ldquo;Do Your Best.&rdquo;
            </p>
            <p>That&apos;s it — Cub Scouting isn&apos;t about being perfect, it&apos;s about trying your best at everything you do.</p>
          </div>

          <div className="section-head">
            <div className="eyebrow">How Scouts Greet Each Other</div>
            <h2>Scout Sign, Salute &amp; Handshake</h2>
          </div>
          <div className="resource-grid" style={{ marginBottom: 40 }}>
            <div className="resource-card">
              <div className="icon-badge">✌️</div>
              <div>
                <h3>Scout Sign</h3>
                <p>
                  Raise your right hand, palm forward, with your first two fingers up in a &ldquo;V&rdquo;
                  (like wolf ears) and your thumb holding down the other two fingers. Scouts give the
                  sign to ask for quiet — everyone who sees it gives the sign back and stops talking.
                </p>
              </div>
            </div>
            <div className="resource-card">
              <div className="icon-badge">🫡</div>
              <div>
                <h3>Scout Salute</h3>
                <p>
                  Make the Scout sign, then bring your first two fingers up to touch the edge of
                  your right eyebrow. Scouts salute the flag and pack leaders as a sign of respect.
                </p>
              </div>
            </div>
            <div className="resource-card">
              <div className="icon-badge">🤝</div>
              <div>
                <h3>Scout Handshake</h3>
                <p>
                  A firm right-handed handshake with a smile and eye contact — a simple, friendly way
                  Scouts greet each other, leaders, and guests at every meeting and event.
                </p>
              </div>
            </div>
          </div>

          <div className="section-head">
            <div className="eyebrow">Getting Badged Up</div>
            <h2>The Cub Scout Uniform</h2>
            <p>
              The official field uniform (&ldquo;Class A&rdquo;) is a tan Scout shirt with navy
              bottoms, worn to meetings, ceremonies, and outings. Here&apos;s where everything
              goes — shown as your scout wears it, so their left is on your right when they&apos;re
              facing you.
            </p>
          </div>

          <div className="info-card" style={{ marginBottom: 40 }}>
            <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "center", justifyContent: "center" }}>
              <svg viewBox="0 0 340 270" width="300" height="238" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Diagram of a Cub Scout uniform shirt with patch placement labeled 1 through 5">
                {/* sleeves */}
                <polygon points="240,80 300,95 288,180 240,168" fill="#e7d3a6" stroke="var(--scout-blue-dark)" strokeWidth="3" strokeLinejoin="round" />
                <polygon points="100,80 40,95 52,180 100,168" fill="#e7d3a6" stroke="var(--scout-blue-dark)" strokeWidth="3" strokeLinejoin="round" />
                {/* body */}
                <rect x="100" y="70" width="140" height="180" rx="18" fill="#e7d3a6" stroke="var(--scout-blue-dark)" strokeWidth="3" />
                {/* collar */}
                <path d="M150,70 L128,84 L152,94 Z" fill="#e7d3a6" stroke="var(--scout-blue-dark)" strokeWidth="3" strokeLinejoin="round" />
                <path d="M190,70 L212,84 L188,94 Z" fill="#e7d3a6" stroke="var(--scout-blue-dark)" strokeWidth="3" strokeLinejoin="round" />
                {/* neckerchief */}
                <path d="M150,88 L190,88 L170,146 Z" fill="var(--scout-gold)" stroke="var(--carnival-red)" strokeWidth="2" strokeLinejoin="round" />
                <circle cx="170" cy="103" r="8" fill="var(--scout-blue)" stroke="var(--scout-blue-dark)" strokeWidth="2" />
                {/* left pocket (viewer-right = wearer's left): world crest + rank */}
                <rect x="178" y="150" width="42" height="48" rx="4" fill="#e7d3a6" stroke="var(--scout-blue-dark)" strokeWidth="2" />
                <circle cx="199" cy="163" r="8" fill="var(--scout-gold)" stroke="var(--scout-blue-dark)" strokeWidth="1.5" />
                <rect x="189" y="176" width="20" height="16" rx="2" fill="var(--teal)" stroke="var(--scout-blue-dark)" strokeWidth="1.5" />
                {/* right pocket (viewer-left = wearer's right) */}
                <rect x="120" y="150" width="42" height="48" rx="4" fill="#e7d3a6" stroke="var(--scout-blue-dark)" strokeWidth="2" strokeDasharray="4 3" />
                {/* council patch + numeral on wearer's left sleeve */}
                <rect x="252" y="100" width="34" height="24" rx="3" fill="var(--scout-blue)" stroke="var(--scout-blue-dark)" strokeWidth="2" />
                <rect x="252" y="128" width="34" height="16" rx="3" fill="var(--carnival-red)" stroke="var(--scout-blue-dark)" strokeWidth="2" />
                {/* flag on wearer's right sleeve */}
                <rect x="54" y="104" width="28" height="18" rx="2" fill="#fff" stroke="var(--scout-blue-dark)" strokeWidth="2" />
                <rect x="54" y="104" width="11" height="8" fill="var(--scout-blue)" />

                {/* callouts */}
                <line x1="232" y1="175" x2="220" y2="170" stroke="var(--ink-soft)" strokeWidth="1.5" />
                <circle cx="232" cy="175" r="11" fill="var(--scout-blue-dark)" />
                <text x="232" y="179" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">1</text>

                <circle cx="170" cy="120" r="11" fill="var(--scout-blue-dark)" />
                <text x="170" y="124" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">2</text>

                <line x1="300" y1="112" x2="286" y2="112" stroke="var(--ink-soft)" strokeWidth="1.5" />
                <circle cx="300" cy="112" r="11" fill="var(--scout-blue-dark)" />
                <text x="300" y="116" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">3</text>

                <line x1="300" y1="136" x2="286" y2="136" stroke="var(--ink-soft)" strokeWidth="1.5" />
                <circle cx="300" cy="136" r="11" fill="var(--scout-blue-dark)" />
                <text x="300" y="140" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">4</text>

                <line x1="30" y1="113" x2="54" y2="113" stroke="var(--ink-soft)" strokeWidth="1.5" />
                <circle cx="30" cy="113" r="11" fill="var(--scout-blue-dark)" />
                <text x="30" y="117" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">5</text>
              </svg>

              <div style={{ flex: "1 1 260px", minWidth: 260 }}>
                <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 10 }}>
                  <li><strong>World Crest &amp; Rank Patch</strong> — left pocket. The gold World Crest sits above the rank patch for your scout&apos;s current rank (Lion, Tiger, Wolf, Bear, Webelos, or Arrow of Light).</li>
                  <li><strong>Neckerchief &amp; Slide</strong> — folded under the collar and held with a slide (also called a woggle). Color matches your scout&apos;s den.</li>
                  <li><strong>Council Patch</strong> — top of the left sleeve, touching the shoulder seam.</li>
                  <li><strong>Pack Numeral</strong> — &ldquo;376,&rdquo; worn directly below the council patch on the left sleeve.</li>
                  <li><strong>American Flag</strong> — optional, worn on the right shoulder at the seam.</li>
                </ol>
              </div>
            </div>
            <p className="form-note" style={{ marginTop: 16, marginBottom: 0, textAlign: "center" }}>
              New to the uniform? Your Den Leader can help you get patches sewn on correctly before your first meeting or campout.
            </p>
          </div>

          <div className="info-card" style={{ borderLeft: "8px solid var(--teal)" }}>
            <div className="eyebrow">Caring for the Outdoors</div>
            <h2 style={{ marginBottom: 12 }}>The Outdoor Code</h2>
            <p style={{ fontSize: 16, lineHeight: 1.8 }}>
              As an American, I will do my best to —
              <br />
              Be clean in my outdoor manners,
              <br />
              Be careful with fire,
              <br />
              Be considerate in the outdoors, and
              <br />
              Be conservation-minded.
            </p>
          </div>
        </div>
      </section>

      <section className="cta-banner">
        <h2>Ready to See It in Action?</h2>
        <p>Check out the camping trips, derbies, and outings scouts experience all year long.</p>
        <div className="hero-actions" style={{ justifyContent: "center", marginTop: 24 }}>
          <Link className="btn btn-primary" href="/activities">See Our Activities</Link>
          <Link className="btn btn-outline" href="/rank-requirements">See Rank Requirements</Link>
        </div>
      </section>

      <Footer />
    </>
  );
}
