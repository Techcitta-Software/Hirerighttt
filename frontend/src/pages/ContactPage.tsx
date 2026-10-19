import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { SiteNav } from '../components/SiteNav'
import { SiteFooter } from '../components/SiteFooter'
import styles from './AuthPages.module.css'

export function ContactPage() {
  const [sent, setSent] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [dataConsent, setDataConsent] = useState(false)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!dataConsent) return
    let tickets: unknown[] = []
    try {
      tickets = JSON.parse(localStorage.getItem('hireright.tickets') || '[]') as unknown[]
      if (!Array.isArray(tickets)) tickets = []
    } catch {
      tickets = []
    }
    tickets.unshift({
      name,
      email,
      message,
      createdAt: new Date().toISOString(),
    })
    localStorage.setItem('hireright.tickets', JSON.stringify(tickets.slice(0, 50)))
    setSent(true)
  }

  return (
    <div className={styles.page}>
      <SiteNav />
      <div className={styles.shell} style={{ paddingTop: '2rem' }}>
        <div className={styles.card}>
          <span className={styles.kicker}>SUPPORT</span>
          <h1>Contact HireRight</h1>
          <p>
            Questions about demos, hiring, or your AI interview? We collect only the fields below to respond
            to you.
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
                  I consent to HireRight processing my name, email, and message to reply to this inquiry, as
                  described in the{' '}
                  <Link to="/privacy" className={styles.termsLink}>
                    Privacy Policy
                  </Link>
                  .
                </span>
              </label>
              <button type="submit" className={styles.submit} disabled={!dataConsent}>
                Send message
              </button>
            </form>
          )}
        </div>
      </div>
      <SiteFooter />
    </div>
  )
}
