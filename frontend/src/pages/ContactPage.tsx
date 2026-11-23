import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MarketingNavBar } from '../components/MarketingNavBar'
import { MarketingFooter } from '../components/MarketingFooter'
import { HrIcon } from '../components/HrIcon'
import { apiFetch } from '../lib/api'
import { accountDisplayName, getUser } from '../lib/store'
import styles from './ContactPage.module.css'

export function ContactPage() {
  const [params, setParams] = useSearchParams()
  const initialMode = params.get('demo') === '1' ? 'demo' : 'support'
  const [mode, setMode] = useState<'demo' | 'support'>(initialMode)
  const isDemo = mode === 'demo'

  const [sent, setSent] = useState(false)
  // Signed-in visitors (e.g. a candidate requesting account deletion from their profile) get name and email filled in.
  const [name, setName] = useState(() => accountDisplayName())
  const [email, setEmail] = useState(() => getUser()?.email || '')
  const [message, setMessage] = useState(() => {
    if (initialMode === 'demo') return 'I would like to book a demo of HireRighttt.'
    return (params.get('message') || '').slice(0, 2000)
  })
  const [dataConsent, setDataConsent] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  function switchMode(newMode: 'demo' | 'support') {
    setMode(newMode)
    setError('')
    setParams(newMode === 'demo' ? { demo: '1' } : {}, { replace: true })
    if (newMode === 'demo' && (!message || message === 'Questions about my AI interview / account: ')) {
      setMessage('I would like to book a demo of HireRighttt for our organization.')
    } else if (newMode === 'support' && message === 'I would like to book a demo of HireRighttt for our organization.') {
      setMessage('')
    }
  }

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

  function handleReset() {
    setSent(false)
    setMessage('')
    setError('')
  }

  return (
    <div className={styles.page}>
      <MarketingNavBar />
      <main className={styles.shell}>
        <div className={styles.layoutGrid}>
          {/* Left Column: Direct Info & Quick Support */}
          <div className={styles.infoCol}>
            <div className={styles.kicker}>
              <HrIcon name="message" size={14} />
              <span>LET&apos;S TALK</span>
            </div>

            <h1 className={styles.title}>
              We&apos;re here to help you <em>hire & interview better.</em>
            </h1>

            <p className={styles.lead}>
              Whether you are an organization looking to automate your screening pipeline or a candidate with questions
              about your 360° scorecard, our support engineering team is at your service.
            </p>

            <div className={styles.slaBadge}>
              <span className={styles.pulseDot} aria-hidden="true" />
              <span>We reply within 2 hours during business hours</span>
            </div>

            <div className={styles.contactDetails}>
              <div className={styles.detailCard}>
                <div className={styles.detailIcon}>
                  <HrIcon name="document" size={18} />
                </div>
                <div className={styles.detailLabel}>Direct Support Email</div>
                <div className={styles.detailValue}>
                  <a href="mailto:support@hirerighttt.com" className={styles.detailLink}>
                    support@hirerighttt.com
                  </a>
                </div>
              </div>

              <div className={styles.detailCard}>
                <div className={styles.detailIcon}>
                  <HrIcon name="clock" size={18} />
                </div>
                <div className={styles.detailLabel}>Operating Hours</div>
                <div className={styles.detailValue}>Mon – Fri, 9am – 7pm IST</div>
              </div>

              <div className={styles.detailCard}>
                <div className={styles.detailIcon}>
                  <HrIcon name="video" size={18} />
                </div>
                <div className={styles.detailLabel}>Live Walkthrough</div>
                <div className={styles.detailValue}>15-min interactive Ava AI demo</div>
              </div>

              <div className={styles.detailCard}>
                <div className={styles.detailIcon}>
                  <HrIcon name="shield-check" size={18} />
                </div>
                <div className={styles.detailLabel}>Pilot Testing</div>
                <div className={styles.detailValue}>Free credits for recruiting teams</div>
              </div>
            </div>

            <div className={styles.quickFaqs}>
              <h3 className={styles.quickFaqsTitle}>Quick Answers</h3>
              <div className={styles.faqMiniList}>
                <div className={styles.faqMiniItem}>
                  <h4>Can I test Ava AI before paying?</h4>
                  <p>Yes, job seekers can sign up free to experience practice questions, and employers can pilot 20 candidate interviews.</p>
                </div>
                <div className={styles.faqMiniItem}>
                  <h4>How do retakes work?</h4>
                  <p>Candidates can retake their 360° interview anytime for ₹89 to refresh scores and application ranks.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Mode Switcher & Form Card */}
          <div className={styles.formCard}>
            <div className={styles.modeSwitcher} role="tablist" aria-label="Inquiry Type">
              <button
                type="button"
                role="tab"
                aria-selected={isDemo}
                className={`${styles.modeBtn} ${isDemo ? styles.modeBtnActive : ''}`}
                onClick={() => switchMode('demo')}
              >
                Book a Demo
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!isDemo}
                className={`${styles.modeBtn} ${!isDemo ? styles.modeBtnActive : ''}`}
                onClick={() => switchMode('support')}
              >
                General Support
              </button>
            </div>

            <div className={styles.formIntro}>
              <h2>{isDemo ? 'See HireRighttt in Action' : 'Get in Touch'}</h2>
              <p>
                {isDemo
                  ? 'Tell us about your team and hiring volume. We’ll schedule a personalized walkthrough.'
                  : 'Have a question about your AI interview, scoring, or account? Send us a message.'}
              </p>
            </div>

            {sent ? (
              <div className={styles.successBox} role="status">
                <div className={styles.successIcon}>
                  <HrIcon name="check" size={28} strokeWidth={3} />
                </div>
                <h3>Message Sent Successfully!</h3>
                <p>
                  Thanks <strong>{name || 'there'}</strong>. We have received your inquiry and will reply to{' '}
                  <strong>{email || 'your inbox'}</strong> within 2 hours.
                </p>
                <button type="button" className={styles.resetBtn} onClick={handleReset}>
                  Send another inquiry
                </button>
              </div>
            ) : (
              <form className={styles.form} onSubmit={handleSubmit}>
                <label className={styles.inputGroup}>
                  <span>Full Name</span>
                  <input
                    className={styles.inputField}
                    name="name"
                    autoComplete="name"
                    placeholder="e.g. Priya Sharma"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </label>

                <label className={styles.inputGroup}>
                  <span>Work Email</span>
                  <input
                    className={styles.inputField}
                    type="email"
                    name="email"
                    autoComplete="email"
                    spellCheck={false}
                    placeholder="priya@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </label>

                <label className={styles.inputGroup}>
                  <span>{isDemo ? 'What roles are you hiring for?' : 'How can we help?'}</span>
                  <textarea
                    className={styles.textareaField}
                    name="message"
                    placeholder={
                      isDemo
                        ? 'e.g. We hire 20-30 frontend and backend engineers per quarter and want to automate our first screen...'
                        : 'Describe your query or issue in detail...'
                    }
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    required
                    rows={4}
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
                    I consent to HireRighttt processing my contact details to reply to this inquiry, as outlined in the{' '}
                    <Link to="/privacy" className={styles.termsLink}>
                      Privacy Policy
                    </Link>
                    .
                  </span>
                </label>

                {error && (
                  <div className={styles.errorBanner} role="alert">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  className={styles.submitBtn}
                  disabled={sending}
                  aria-busy={sending || undefined}
                >
                  {sending ? (
                    <>
                      <span className="ds-spinner" aria-hidden="true" />
                      <span>Sending inquiry…</span>
                    </>
                  ) : isDemo ? (
                    'Request Personalized Demo →'
                  ) : (
                    'Send Message →'
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      </main>
      <MarketingFooter />
    </div>
  )
}
