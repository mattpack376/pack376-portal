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
            Cub Scout Pack 376, chartered by Our Lady of Grace, Brooklyn, NY. All families
            welcome — boys and girls, K–5. Real adventures, lifelong skills, boardwalk spirit.
          </p>
          <a className="footer-instagram" href="https://instagram.com/pack.376" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zm0 10.162a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
            </svg>
            <span>@pack.376 on Instagram</span>
          </a>
        </div>
        <div>
          <h4>Explore</h4>
          <ul>
            <li><Link href="/">Home</Link></li>
            <li><Link href="/parent-resources">Parent Resources</Link></li>
            <li><Link href="/leader-resources">Leader Resources</Link></li>
            <li><Link href="/den-leaders-corner">Den Leaders&apos; Corner</Link></li>
            <li><Link href="/rank-requirements">Rank Requirements</Link></li>
            <li><Link href="/gallery">Photo Albums</Link></li>
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
