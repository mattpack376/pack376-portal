import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Rank Requirements — Pack 376",
  description: "Cub Scout rank requirements overview for Pack 376: Lion, Tiger, Wolf, Bear, Webelos, and Arrow of Light.",
};

type RankCard = {
  badgeClass: string;
  star: string;
  grade: string;
  tagline: string;
  name: string;
  blurb: string;
  tags: string[];
  pdf: string;
};

const RANKS: RankCard[] = [
  {
    badgeClass: "rk-lion",
    star: "LION",
    grade: "Kindergarten",
    tagline: "First Steps on the Boardwalk",
    name: "Lion",
    blurb: "Lions explore Cub Scouting alongside a parent or guardian \"Lion Guide,\" building teamwork and curiosity through hands-on adventures designed for kindergarten-age scouts.",
    tags: ["Mountain Lion", "Fun on the Run", "King of the Jungle", "Lion's Roar", "Lion's Pride"],
    pdf: "/requirements/Lion-Adventure-Requirements.pdf",
  },
  {
    badgeClass: "rk-tiger",
    star: "TIGER",
    grade: "1st Grade",
    tagline: "Fast, Fierce, and Just Getting Started",
    name: "Tiger",
    blurb: "Tigers pair up with an adult partner to complete required and elective adventures covering outdoor skills, fitness, citizenship, and family fun.",
    tags: ["Tigers in the Wild", "Tiger Bites", "Team Tiger", "Tiger's Roar", "Tiger Circles"],
    pdf: "/requirements/Tiger-Adventure-Requirements.pdf",
  },
  {
    badgeClass: "rk-wolf",
    star: "WOLF",
    grade: "2nd Grade",
    tagline: "Running with the Pack",
    name: "Wolf",
    blurb: "Wolves take on more independence — completing adventures in citizenship, fitness, and the outdoors while learning to work as part of a den.",
    tags: ["Paws on the Path", "Running with the Pack", "Council Fire", "Safety in Numbers", "Footsteps"],
    pdf: "/requirements/Wolf-Adventure-Requirements.pdf",
  },
  {
    badgeClass: "rk-bear",
    star: "BEAR",
    grade: "3rd Grade",
    tagline: "Bigger Adventures, Bigger Confidence",
    name: "Bear",
    blurb: "Bears dig into science, cooking, community, and the outdoors — building skills that carry straight into Webelos and beyond.",
    tags: ["Bear Habitat", "Bear Strong", "Paws for Action", "Standing Tall", "Fellowship"],
    pdf: "/requirements/Bear-Adventure-Requirements.pdf",
  },
  {
    badgeClass: "rk-webelos",
    star: "WEB",
    grade: "4th Grade",
    tagline: "Bridging Toward Boy-Led Adventure",
    name: "Webelos",
    blurb: "Webelos scouts take on more challenging, self-directed adventures and start building the outdoor and leadership skills that prepare them for Scouts BSA.",
    tags: ["Webelos Walkabout", "Stronger, Faster, Higher", "My Community", "My Safety", "My Family"],
    pdf: "/requirements/Webelos-Adventure-Requirements.pdf",
  },
  {
    badgeClass: "rk-aol",
    star: "AOL",
    grade: "5th Grade",
    tagline: "The Top of the Wheel",
    name: "Arrow of Light",
    blurb: "The highest Cub Scout rank — scouts organize into a patrol and complete adventures focused on outdoor readiness, first aid, and leadership, then cross the bridge into Scouts BSA at Graduation Night.",
    tags: ["Outdoor Adventurer", "Personal Fitness", "Citizenship", "First Aid", "Duty to God"],
    pdf: "/requirements/Arrow-of-Light-Adventure-Requirements.pdf",
  },
];

export default function RankRequirementsPage() {
  return (
    <>
      <Header />

      <section className="page-hero">
        <div className="eyebrow" style={{ background: "rgba(255,255,255,0.15)", color: "var(--scout-gold)" }}>
          The Ride Line-Up
        </div>
        <h1>Rank Requirements</h1>
        <p>
          Six ranks, six grade levels, one great climb. Here&apos;s a quick-look overview of
          each — dens work through required and elective adventures together across the
          scouting year.
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
          {RANKS.map((rank) => (
            <div className="rank-detail-card" key={rank.name}>
              <div className={`rank-detail-side ${rank.badgeClass}`}>
                <div className="rank-star">{rank.star}</div>
                <div className="grade">{rank.grade}</div>
              </div>
              <div className="rank-detail-body">
                <div className="tagline">{rank.tagline}</div>
                <h2>{rank.name}</h2>
                <p>{rank.blurb}</p>
                <div className="adventure-tags">
                  {rank.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
                <a
                  className="link"
                  href={rank.pdf}
                  target="_blank"
                  rel="noopener"
                  style={{ display: "inline-block", marginTop: 14 }}
                >
                  📄 Download {rank.name} Adventure Requirements (PDF)
                </a>
              </div>
            </div>
          ))}

          <div className="info-card" style={{ textAlign: "center", marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>Full, Up-to-Date Requirements</h3>
            <p>
              Adventure requirements are set and periodically updated by the Boy Scouts of
              America. For the complete, official checklist for each rank, visit the BSA
              program pages — your den leader can also walk you through exactly what&apos;s
              needed this year.
            </p>
            <a
              className="btn btn-primary"
              href="https://www.scouting.org/programs/cub-scouts/adventures/"
              target="_blank"
              rel="noopener"
            >
              Official BSA Adventure Requirements
            </a>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
