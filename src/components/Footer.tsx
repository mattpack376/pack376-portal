import Link from "next/link";
import Image from "next/image";

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="footer-stripe" />
      <div className="footer-grid">
        <div>
          <div className="footer-brand">
            <Image src="/cub-scout-emblem.png" alt="Pack 376 Cub Scouts emblem" width={40} height={40} />
            <span className="pack-name">Pack 376</span>
          </div>
          <p>
            Cub Scout Pack 376, chartered by Our Lady of Grace, Brooklyn, NY. Real
            adventures, lifelong skills, boardwalk spirit.
          </p>
          <p>
            <a href="https://instagram.com/pack.376" target="_blank" rel="noopener">
              @pack.376 on Instagram
            </a>
          </p>
        </div>
        <div>
          <h4>Explore</h4>
          <ul>
            <li><Link href="/">Home</Link></li>
            <li><Link href="/parent-resources">Parent Resources</Link></li>
            <li><Link href="/leader-resources">Leader Resources</Link></li>
            <li><Link href="/rank-requirements">Rank Requirements</Link></li>
            <li><Link href="/contact">Contact Us</Link></li>
            <li><Link href="/portal/login">Den Leader Login</Link></li>
          </ul>
        </div>
        <div>
          <h4>Find Us</h4>
          <p>
            Veltri Hall, Our Lady of Grace
            <br />
            430 Avenue W
            <br />
            Brooklyn, NY 11223
          </p>
        </div>
      </div>
      <div className="footer-bottom">
        © {year} Cub Scout Pack 376 · Brooklyn, NY · Registration fees apply
      </div>
    </footer>
  );
}
