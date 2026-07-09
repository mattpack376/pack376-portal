import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import ContactForm from "@/components/ContactForm";

export const metadata: Metadata = {
  title: "Contact Us — Pack 376",
  description: "Get in touch with Cub Scout Pack 376 in Brooklyn, NY. Visit a pack night, ask a question, or sign up to join.",
};

export default function ContactPage() {
  return (
    <>
      <Header />

      <section className="page-hero">
        <div className="eyebrow" style={{ background: "rgba(255,255,255,0.15)", color: "var(--scout-gold)" }}>
          Find Us on the Boardwalk
        </div>
        <h1>Contact Us</h1>
        <p>Questions about joining, volunteering, or visiting a pack night? We&apos;d love to hear from you.</p>
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
        <div className="container contact-grid">
          <div>
            <div className="info-card" style={{ marginBottom: 24 }}>
              <h3 style={{ marginTop: 0 }}>Reach a Leader</h3>
              <div className="contact-method">
                <div className="icon-badge">📞</div>
                <div>
                  <h4>Howell Woods, Cubmaster</h4>
                  <a href="tel:6467502836">646-750-2836</a>
                </div>
              </div>
              <div className="contact-method">
                <div className="icon-badge">📍</div>
                <div>
                  <h4>Meeting Location</h4>
                  <p>Veltri Hall, Our Lady of Grace<br />430 Avenue W, Brooklyn, NY 11223</p>
                </div>
              </div>
              <div className="contact-method">
                <div className="icon-badge">📷</div>
                <div>
                  <h4>Instagram</h4>
                  <a href="https://instagram.com/pack.376" target="_blank" rel="noopener">@pack.376</a>
                </div>
              </div>
              <div className="contact-method">
                <div className="icon-badge">🗓️</div>
                <div>
                  <h4>Meetings</h4>
                  <p>Weekly, Fridays 7:00–9:30 PM — new scouts and families welcome anytime, no experience needed.</p>
                </div>
              </div>
            </div>

            <div className="map-embed">
              <iframe
                src="https://maps.google.com/maps?q=430%20Avenue%20W%2C%20Brooklyn%2C%20NY%2011223&t=&z=15&ie=UTF8&iwloc=&output=embed"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title="Map to Veltri Hall, Our Lady of Grace, 430 Avenue W, Brooklyn NY"
              />
            </div>
          </div>

          <div className="info-card">
            <h3 style={{ marginTop: 0 }}>Send a Message</h3>
            <p>Fill this out and it&apos;ll open in your email app, ready to send straight to the pack.</p>
            <ContactForm />
          </div>
        </div>
      </section>

      <section className="cta-banner section-tight">
        <h2>Open to All Families</h2>
        <p>No experience needed — visit us at any weekly Friday meeting or monthly pack night event and see what Pack 376 is all about.</p>
      </section>

      <Footer />
    </>
  );
}
