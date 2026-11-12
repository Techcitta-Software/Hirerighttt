import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BrandLogo } from '../components/BrandLogo'
import { apiConnectionHint, apiHealth, apiSignup, setApiToken } from '../lib/api'
import { stashSignupLoginHandoff } from '../lib/authHandoff'
import { requireApiForAuth } from '../lib/authConfig'
import { clearSessionValidationCache } from '../lib/authSession'
import { isValidPhone, normalizePhone } from '../lib/phone'
import { isSupabaseEnabled } from '../lib/supabaseClient'
import { clearProfileForEmail, logout, saveUser } from '../lib/store'
import { LoginPage } from './AuthPages'
import styles from './OrganizationSignupPage.module.css'

/** What a hiring team actually gets — mirrors the employer workspace. */
const OFFERINGS = [
  {
    title: 'Post a job, share one link',
    desc: 'Create an opening from a job description. Candidates apply and interview from the link.',
  },
  {
    title: 'AI interviews, every candidate',
    desc: 'Each applicant gets a role-specific interview based on the JD and their resume.',
  },
  {
    title: 'Scored reports and recordings',
    desc: 'Review scores, transcripts, recordings and integrity flags in one place.',
  },
  {
    title: 'Shortlist and invite',
    desc: 'Rank applicants, search the talent pool, and send interview invites by email.',
  },
]

export function OrganizationSignupPage() {
  // Supabase auth keeps its own flow in the shared auth page.
  if (isSupabaseEnabled()) return <LoginPage initialMode="signup" fixedRole="employer" />
  return <OrganizationSignupForm />
}

function OrganizationSignupForm() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const cleanEmail = email.trim().toLowerCase()
    if (!name.trim() || !company.trim() || !cleanEmail || !password) {
      setError('Fill in all fields to create your account.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Enter a valid work email.')
      return
    }
    if (!isValidPhone(phone)) {
      setError('Enter a valid mobile number (10–15 digits).')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (!agreed) {
      setError('Please agree to the Terms of Use and Privacy Policy.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const phoneNorm = normalizePhone(phone) || phone.trim()
      if (await apiHealth()) {
        await apiSignup(name.trim(), cleanEmail, password, {
          role: 'employer',
          companyName: company.trim(),
          phone: phoneNorm,
          storeSessionToken: false,
        })
      } else if (requireApiForAuth()) {
        setError(apiConnectionHint())
        return
      }
      saveUser(
        {
          name: name.trim(),
          email: cleanEmail,
          password,
          role: 'employer',
          companyName: company.trim(),
          phone: phoneNorm,
        },
        true,
        false,
      )
      clearProfileForEmail(cleanEmail)
      setApiToken(null)
      logout()
      clearSessionValidationCache()
      const message = 'Account created. Sign in to open your workspace.'
      stashSignupLoginHandoff({ email: cleanEmail, password, message })
      navigate('/login', { replace: true, state: { explicitLogin: true } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your account.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <BrandLogo to="/" size="md" />
        <Link to="/login" state={{ explicitLogin: true }} className={styles.topLink}>
          Log in
        </Link>
      </header>

      <main className={styles.main}>
        <section className={styles.intro}>
          <p className={styles.kicker}>For hiring teams</p>
          <h1>Screen every candidate with an AI interview.</h1>
          <p className={styles.lead}>
            Post a role, share a link, and review scored interviews instead of sorting resumes.
          </p>
          <ol className={styles.steps}>
            {OFFERINGS.map((o, i) => (
              <li key={o.title}>
                <span className={styles.num}>{i + 1}</span>
                <div>
                  <h2>{o.title}</h2>
                  <p>{o.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.card} aria-labelledby="org-signup-title">
          <h2 id="org-signup-title">Create your organisation account</h2>
          <form onSubmit={handleSubmit} noValidate>
            <label>
              Your name
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </label>
            <label>
              Organisation name
              <input value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" />
            </label>
            <label>
              Work email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </label>
            <label>
              Mobile number
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label className={styles.check}>
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>
                I agree to the <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>.
              </span>
            </label>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <button type="submit" disabled={loading}>
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
          <p className={styles.alt}>
            Already have an account?{' '}
            <Link to="/login" state={{ explicitLogin: true }}>
              Log in
            </Link>
          </p>
        </section>
      </main>
    </div>
  )
}
