import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { MarketingNavBar } from '../components/MarketingNavBar'
import { MarketingFooter } from '../components/MarketingFooter'
import { apiRequestPasswordReset, apiResetPassword } from '../lib/api'
import styles from './AuthPages.module.css'

const MIN_PASSWORD_LENGTH = 8

function ResetShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <MarketingNavBar />
      <div className={styles.shell} style={{ paddingTop: '2rem' }}>
        <div className={styles.card}>{children}</div>
      </div>
      <MarketingFooter />
    </div>
  )
}

/** Step 1: ask for the account email and send a reset link. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sentMessage, setSentMessage] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (sending) return
    setSending(true)
    setError('')
    try {
      const message = await apiRequestPasswordReset(email.trim())
      setSentMessage(
        message ||
          "If an account exists for that email, we've sent a link to reset the password. The link expires in 30 minutes.",
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the reset link. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <ResetShell>
      <h1>Reset your password</h1>
      {sentMessage ? (
        <>
          <p className={styles.success} role="status">
            {sentMessage}
          </p>
          <p style={{ marginTop: '1rem' }}>
            Didn’t get it? Check your spam folder, or{' '}
            <button type="button" className={styles.switchModeLink} onClick={() => setSentMessage('')}>
              try again
            </button>
            .
          </p>
          <p style={{ marginTop: '0.75rem' }}>
            <Link to="/login" className={styles.switchModeLink}>
              Back to log in
            </Link>
          </p>
        </>
      ) : (
        <>
          <p>Enter the email you use for HireRighttt and we’ll send you a link to choose a new password.</p>
          <form className={styles.form} onSubmit={handleSubmit}>
            {error ? (
              <div className={styles.errorBanner} role="alert">
                {error}
              </div>
            ) : null}
            <label>
              Email address
              <input
                type="email"
                name="email"
                autoComplete="email"
                spellCheck={false}
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </label>
            <button type="submit" className={styles.submit} disabled={sending}>
              {sending ? (
                <>
                  <span className="ds-spinner" aria-hidden="true" /> Sending link…
                </>
              ) : (
                'Send reset link'
              )}
            </button>
          </form>
          <p style={{ marginTop: '1rem' }}>
            Remembered it?{' '}
            <Link to="/login" className={styles.switchModeLink}>
              Back to log in
            </Link>
          </p>
        </>
      )}
    </ResetShell>
  )
}

/** Step 2: the emailed link lands here with ?token=… to set a new password. */
export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') || ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError('The two passwords don’t match.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const message = await apiResetPassword(token, password)
      setDone(message || 'Your password has been reset. Log in with your new password.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset your password. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!token) {
    return (
      <ResetShell>
        <h1>Reset link missing</h1>
        <p>This page needs the link from your reset email. Request a new link and open it from your inbox.</p>
        <p style={{ marginTop: '1.25rem' }}>
          <Link to="/forgot-password" className={styles.switchModeLink}>
            Request a new reset link
          </Link>
        </p>
      </ResetShell>
    )
  }

  return (
    <ResetShell>
      <h1>Choose a new password</h1>
      {done ? (
        <>
          <p className={styles.success} role="status">
            {done}
          </p>
          <p style={{ marginTop: '0.75rem', color: '#5f6686' }}>
            For your security, you’ve been signed out on all devices.
          </p>
          <button
            type="button"
            className={styles.submit}
            style={{ marginTop: '1.25rem' }}
            onClick={() => navigate('/login', { replace: true })}
          >
            Go to log in
          </button>
        </>
      ) : (
        <>
          <p>Use at least {MIN_PASSWORD_LENGTH} characters. You’ll be signed out on all devices afterwards.</p>
          <form className={styles.form} onSubmit={handleSubmit}>
            {error ? (
              <div className={styles.errorBanner} role="alert">
                {error}
                {/expired|invalid|incomplete/i.test(error) ? (
                  <>
                    {' '}
                    <Link to="/forgot-password" className={styles.switchModeLink}>
                      Request a new link
                    </Link>
                  </>
                ) : null}
              </div>
            ) : null}
            <label>
              New password
              <input
                type="password"
                name="new-password"
                autoComplete="new-password"
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={MIN_PASSWORD_LENGTH}
                required
                autoFocus
              />
            </label>
            <label>
              Confirm new password
              <input
                type="password"
                name="confirm-password"
                autoComplete="new-password"
                placeholder="Type it again"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
            </label>
            <button type="submit" className={styles.submit} disabled={saving}>
              {saving ? (
                <>
                  <span className="ds-spinner" aria-hidden="true" /> Saving…
                </>
              ) : (
                'Save new password'
              )}
            </button>
          </form>
        </>
      )}
    </ResetShell>
  )
}
