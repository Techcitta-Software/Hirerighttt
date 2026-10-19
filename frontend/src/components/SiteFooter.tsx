import { Link } from 'react-router-dom'
import { PlatformWorkflowSection } from './PlatformWorkflowSection'
import { BrandLogo } from './BrandLogo'
import styles from './SiteFooter.module.css'

type SiteFooterProps = {
  /** Set false on /how-it-works where the same block is already in the page body */
  showWorkflow?: boolean
  /** Light footer for minimalist marketing pages */
  tone?: 'dark' | 'light'
}

export function SiteFooter({ showWorkflow = false, tone = 'dark' }: SiteFooterProps) {
  return (
    <>
      {showWorkflow && <PlatformWorkflowSection />}
    <footer className={tone === 'light' ? `${styles.footer} ${styles.footerLight}` : styles.footer}>
      <div className={styles.grid}>
        <div>
          <BrandLogo dark={tone !== 'light'} size="lg" />

          <p className={styles.tagline}>
            Fair AI interviews and clear scorecards — for candidates and employers.
          </p>
        </div>
        <div>
          <h4>For Job Seekers</h4>
          <Link to="/job-seekers">Overview</Link>
          <Link to="/signup">Create account</Link>
          <Link to="/interview">AI Interview</Link>
        </div>
        <div>
          <h4>Resources</h4>
          <Link to="/resources">Help center</Link>
          <Link to="/how-it-works">How it works</Link>
          <Link to="/contact">Contact</Link>
        </div>
        <div>
          <h4>About HireRight</h4>
          <Link to="/about">About us</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms &amp; Conditions</Link>
          <Link to="/cookies">Cookie Policy</Link>
        </div>
      </div>
      <div className={styles.bottom}>
        <span>© {new Date().getFullYear()} HireRight. All rights reserved.</span>
        <span className={styles.legalInline}>
          <Link to="/privacy">Privacy</Link>
          <span aria-hidden>·</span>
          <Link to="/terms">Terms</Link>
          <span aria-hidden>·</span>
          <Link to="/cookies">Cookies</Link>
        </span>
        <div className={styles.social}>
          <a href="https://linkedin.com" aria-label="LinkedIn">
            in
          </a>
          <a href="https://instagram.com" aria-label="Instagram">
            ig
          </a>
          <a href="https://facebook.com" aria-label="Facebook">
            fb
          </a>
        </div>
      </div>
    </footer>
    </>
  )
}
