import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MarketingNavBar } from '../components/MarketingNavBar'
import { MarketingFooter } from '../components/MarketingFooter'
import { apiFetch } from '../lib/api'
import styles from './AuthPages.module.css'

export function ContactPage() {
  const [params] = useSearchParams()
  const isDemo = params.get('demo') === '1'
  const [sent, setSent] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState(() =>
    new URLSearchParams(window.location.search).get('demo') === '1'
      ? 'I would like to book a demo of HireRighttt.'
      : '',
  )
  const [dataConsent, setDataConsent] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!dataConsent || sending) return
    setSending(true)
    setError('')
    try {
      const res = await apiFetch('/api/contact', {
        method: 'POST',
        body: JSON.stringify({ name, email, message, type: isDemo ? 'demo' : 'support' }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || 'Could not send your message. Please try again.')
      }
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your message. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={styles.page}>
      <MarketingNavBar />
      <div className={styles.shell} style={{ paddingTop: '2rem' }}>
        <div className={styles.card}>
          <span className={styles.kicker}>{isDemo ? 'BOOK A DEMO' : 'SUPPORT'}</span>
          <h1>{isDemo ? 'See HireRighttt in action' : 'Contact HireRighttt'}</h1>
          <p>
            {isDemo
              ? 'Tell us a little about your hiring needs and we will arrange a walkthrough.'
              : 'Questions about hiring or your AI interview? We collect only the fields below to respond to you.'}
          </p>
          {sent ? (
            <p className={styles.success}>Thanks {name || 'there'}. We’ll reply to {email || 'your inbox'}.</p>
          ) : (
            <form className={styles.form} onSubmit={handleSubmit}>
              <label>
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
              <label>
                Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </label>
              <label>
                Message
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                  rows={5}
                  style={{ width: '100%', padding: 12, borderRadius: 10, border: '1px solid #e2e8f0' }}
                />
              </label>
              <label className={styles.termsRow}>
                <input
                  type="checkbox"
                  checked={dataConsent}
                  onChange={(e) => setDataConsent(e.target.checked)}
                  required
                />
                <span>
                  I consent to HireRighttt processing my name, email, and message to reply to this inquiry, as
                  described in the{' '}
                  <Link to="/privacy" className={styles.termsLink}>
                    Privacy Policy
                  </Link>
                  .
                </span>
              </label>
              {error ? (
                <div className={styles.errorBanner} role="alert">
                  {error}
                </div>
              ) : null}
              <button type="submit" className={styles.submit} disabled={!dataConsent || sending}>
                {sending ? 'Sending…' : isDemo ? 'Request demo' : 'Send message'}
              </button>
            </form>
          )}
        </div>
      </div>
      <MarketingFooter />
    </div>
  )
}
