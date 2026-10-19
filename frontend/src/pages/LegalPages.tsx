import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { SiteNav } from '../components/SiteNav'
import { SiteFooter } from '../components/SiteFooter'
import {
  acceptEssentialCookiesOnly,
  getCookieConsent,
  hasCookieConsentDecision,
} from '../lib/cookieConsent'
import styles from './LegalPages.module.css'

const LAST_UPDATED = '19 October 2026'

function LegalShell({
  kicker,
  title,
  children,
}: {
  kicker: string
  title: string
  children: ReactNode
}) {
  return (
    <div className={styles.page}>
      <SiteNav />
      <div className={styles.shell}>
        <article className={styles.card}>
          <span className={styles.kicker}>{kicker}</span>
          <h1>{title}</h1>
          <p className={styles.updated}>Last updated: {LAST_UPDATED}</p>
          <div className={styles.prose}>{children}</div>
        </article>
      </div>
      <SiteFooter tone="light" />
    </div>
  )
}

export function PrivacyPolicyPage() {
  return (
    <LegalShell kicker="LEGAL" title="Privacy Policy">
      <p>
        HireRight (&quot;we&quot;, &quot;us&quot;) provides AI-assisted interviews, career scorecards, and hiring
        tools for candidates and employers. This Privacy Policy explains what personal data we collect, why we
        collect it, and your choices.
      </p>

      <h2>Data we collect (minimum necessary)</h2>
      <ul>
        <li>
          <strong>Account data:</strong> name, email, phone (when you provide it), password hash, and role
          (candidate or employer).
        </li>
        <li>
          <strong>Profile &amp; hiring data:</strong> résumé text, skills, experience, job preferences, and
          application materials you upload.
        </li>
        <li>
          <strong>Interview data:</strong> questions, answers, scores, proctoring signals you enable, and
          generated reports.
        </li>
        <li>
          <strong>Employer job data:</strong> job descriptions, applicant submissions, and recruiter actions
          on your organization&apos;s roles.
        </li>
        <li>
          <strong>Technical data:</strong> essential session identifiers, security logs, and device storage
          needed to keep you signed in and protect the service.
        </li>
      </ul>
      <p>
        We do <strong>not</strong> sell personal data. We do not use your data for unrelated advertising
        profiles.
      </p>

      <h2>Why we use your data</h2>
      <ul>
        <li>To create and secure your account and provide the service you request.</li>
        <li>To score interviews, generate scorecards, and match candidates to employer roles you apply to.</li>
        <li>To let employers review applications you submit to their jobs.</li>
        <li>To respond to support messages when you contact us.</li>
        <li>To comply with law and prevent abuse.</li>
      </ul>

      <h2>Legal bases</h2>
      <p>
        Where applicable, we rely on <strong>contract</strong> (providing the platform),{' '}
        <strong>consent</strong> (optional forms, cookies beyond strictly necessary storage), and{' '}
        <strong>legitimate interests</strong> (security and service improvement) balanced against your
        rights.
      </p>

      <h2>Sharing</h2>
      <p>
        We share data only as needed: with employers when you apply to their jobs, with infrastructure
        providers (hosting, email, AI processing) under confidentiality obligations, and when required by
        law. Interview recordings and scorecards are shared with recruiters only according to your visibility
        settings and the job context.
      </p>

      <h2>Retention</h2>
      <p>
        We keep data while your account is active and as needed for hiring records, legal obligations, or
        disputes. You may request deletion subject to exceptions (e.g. employer records for compliance).
      </p>

      <h2>Your rights</h2>
      <p>
        Depending on your location, you may access, correct, delete, or restrict processing of your personal
        data, and withdraw consent where processing is consent-based. Contact us via{' '}
        <Link to="/contact">Contact</Link> to exercise these rights.
      </p>

      <h2>Children</h2>
      <p>HireRight is not directed at children under 16. We do not knowingly collect their data.</p>

      <h2>Changes</h2>
      <p>
        We may update this policy. Material changes will be posted on this page with a new &quot;Last
        updated&quot; date.
      </p>

      <p>
        See also our <Link to="/terms">Terms &amp; Conditions</Link> and{' '}
        <Link to="/cookies">Cookie Policy</Link>.
      </p>
    </LegalShell>
  )
}

export function TermsPage() {
  return (
    <LegalShell kicker="LEGAL" title="Terms & Conditions">
      <p>
        By accessing or using HireRight, you agree to these Terms &amp; Conditions. If you do not agree, do
        not use the service.
      </p>

      <h2>Service</h2>
      <p>
        HireRight offers AI-assisted interviews, candidate profiles, employer job posting, and application
        workflows. Features may change; we strive to maintain reasonable availability but do not guarantee
        uninterrupted access.
      </p>

      <h2>Accounts</h2>
      <ul>
        <li>You must provide accurate registration information and keep credentials secure.</li>
        <li>One person or organization per account type as described at signup.</li>
        <li>Employer accounts must not apply to jobs as fake candidates.</li>
      </ul>

      <h2>Your content</h2>
      <p>
        You retain ownership of résumés, answers, and materials you submit. You grant HireRight a license to
        host, process, and display that content to operate the service (including AI scoring and sharing with
        employers you apply to).
      </p>

      <h2>Acceptable use</h2>
      <ul>
        <li>No fraud, impersonation, harassment, or circumventing interview integrity controls.</li>
        <li>No scraping, reverse engineering, or misuse of API keys or employer data.</li>
        <li>No unlawful discrimination in hiring decisions using platform outputs alone.</li>
      </ul>

      <h2>AI outputs</h2>
      <p>
        Interview scores and AI-generated feedback are decision-support tools, not sole grounds for employment
        decisions. Employers remain responsible for compliant hiring practices.
      </p>

      <h2>Disclaimer</h2>
      <p>
        The service is provided &quot;as is&quot; to the extent permitted by law. We disclaim implied
        warranties where allowed. Our liability is limited to the maximum extent permitted by applicable law.
      </p>

      <h2>Termination</h2>
      <p>
        You may stop using HireRight at any time. We may suspend accounts that violate these terms or pose
        security risks.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws applicable to the operating entity stated in your order or
        signup confirmation, without regard to conflict-of-law rules. Update your registered business details
        before production launch.
      </p>

      <p>
        Privacy practices are described in our <Link to="/privacy">Privacy Policy</Link>.
      </p>
    </LegalShell>
  )
}

export function CookiePolicyPage() {
  const decided = hasCookieConsentDecision()
  const choice = getCookieConsent()

  function saveEssentialOnly() {
    acceptEssentialCookiesOnly()
    window.dispatchEvent(new Event('hireright:cookie-consent-reset'))
  }

  function reopenBanner() {
    localStorage.removeItem('hireright.cookieConsent')
    window.dispatchEvent(new Event('hireright:cookie-consent-reset'))
  }

  return (
    <LegalShell kicker="LEGAL" title="Cookie Policy">
      <p>
        This policy explains how HireRight uses cookies and similar technologies (including local storage) on
        our website and application.
      </p>

      <h2>Our approach: essential only</h2>
      <p>
        We designed HireRight to collect only what is necessary. We do <strong>not</strong> use advertising
        or cross-site tracking cookies. We do not sell cookie data.
      </p>

      <h2>What we use</h2>
      <ul>
        <li>
          <strong>Strictly necessary:</strong> authentication session tokens, CSRF/security, load balancing,
          and consent records (so we do not ask repeatedly).
        </li>
        <li>
          <strong>Functional (on-device):</strong> local storage for draft profile data, interview progress,
          and UI preferences tied to your account experience.
        </li>
      </ul>
      <p>We do not enable optional analytics or marketing cookies in the product by default.</p>

      <h2>Third parties</h2>
      <p>
        If you use features that rely on external providers (e.g. sign-in, email, cloud hosting), those
        providers may set their own essential cookies subject to their policies. We configure integrations to
        minimize data collection.
      </p>

      <h2>Managing preferences</h2>
      <p>
        On first visit, we ask you to accept essential storage only. You can review or reset your choice
        below. Blocking essential cookies may prevent sign-in and core features from working.
      </p>

      {decided && choice ? (
        <p className={styles.consentNote}>
          Current choice: essential cookies only — saved on {new Date(choice.decidedAt).toLocaleString()}.
        </p>
      ) : (
        <p className={styles.consentNote}>You have not saved a cookie preference on this browser yet.</p>
      )}

      <div className={styles.cookieActions}>
        <button type="button" className={styles.primaryBtn} onClick={saveEssentialOnly}>
          Accept essential only
        </button>
        <button type="button" className={styles.secondaryBtn} onClick={reopenBanner}>
          Show consent banner again
        </button>
      </div>

      <p style={{ marginTop: '1.5rem' }}>
        For personal data processing, see our <Link to="/privacy">Privacy Policy</Link>.
      </p>
    </LegalShell>
  )
}
