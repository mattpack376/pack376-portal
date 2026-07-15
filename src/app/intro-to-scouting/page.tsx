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
