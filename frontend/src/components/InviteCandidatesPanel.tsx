import { useState, type FormEvent } from 'react'
import { sendInterviewLinks, type SentInvite } from '../lib/vendorApi'
import styles from './InviteCandidatesPanel.module.css'

type Props = {
  jobs: { id: string; title: string }[]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Recruiter tool: paste emails -> each person gets an interview link that opens a resume-based AI interview. */
export function InviteCandidatesPanel({ jobs }: Props) {
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState('')
  const [jobId, setJobId] = useState('')
  const [days, setDays] = useState(7)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<SentInvite[] | null>(null)
  const [mailReady, setMailReady] = useState(true)
  const [copied, setCopied] = useState('')

  const emails = Array.from(
    new Set(
      raw
        .split(/[\s,;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  )
  const valid = emails.filter((e) => EMAIL_RE.test(e))
  const invalid = emails.filter((e) => !EMAIL_RE.test(e))

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid.length || sending) return
    setSending(true)
    setError('')
    setResults(null)
    try {
      const out = await sendInterviewLinks({
        candidates: valid.map((email) => ({ email })),
        jobId: jobId || undefined,
        expiresInDays: days,
      })
      setResults(out.invites)
      setMailReady(out.smtpConfigured)
      if (out.invites.every((i) => i.emailSent)) setRaw('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the invitations.')
    } finally {
      setSending(false)
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(url)
      window.setTimeout(() => setCopied(''), 1800)
    } catch {
      /* clipboard blocked — the link is shown in the list to copy by hand */
    }
  }

  return (
    <section className={styles.panel} aria-label="Send interview links">
      <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>
          <strong>Send interview links</strong>
          <span className={styles.hint}> — email people a link that opens their interview directly</span>
        </span>
        <span aria-hidden>{open ? '–' : '+'}</span>
      </button>

      {open ? (
        <form className={styles.body} onSubmit={onSubmit}>
          <label className={styles.label} htmlFor="invite-emails">
            Candidate emails
          </label>
          <textarea
            id="invite-emails"
            className={styles.textarea}
            rows={4}
            placeholder={'asha@example.com\nravi@example.com'}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
          <p className={styles.meta}>
            {valid.length} valid{invalid.length ? ` · ${invalid.length} not recognised (${invalid.slice(0, 3).join(', ')})` : ''}
            {' · '}up to 50 per send
          </p>

          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="invite-job">
                Role (optional)
              </label>
              <select id="invite-job" className={styles.input} value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">General AI interview</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="invite-days">
                Link valid for
              </label>
              <select id="invite-days" className={styles.input} value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {[1, 3, 7, 14, 30].map((d) => (
                  <option key={d} value={d}>
                    {d} day{d > 1 ? 's' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className={styles.send} disabled={!valid.length || sending}>
            {sending ? 'Sending…' : `Send ${valid.length || ''} interview link${valid.length === 1 ? '' : 's'}`}
          </button>

          {results ? (
            <div className={styles.results} role="status">
              {!mailReady ? (
                <p className={styles.warn}>
                  Email is not set up on the server yet, so nothing was emailed. Copy each link below and send it yourself.
                </p>
              ) : null}
              <ul>
                {results.map((r) => (
                  <li key={r.email} className={styles.result}>
                    <span className={r.emailSent ? styles.ok : styles.fail} aria-hidden>
                      {r.emailSent ? '✓' : '!'}
                    </span>
                    <span className={styles.who}>
                      {r.email}
                      {!r.emailSent && r.emailError ? <em> — {r.emailError}</em> : <em> — emailed</em>}
                    </span>
                    <button type="button" className={styles.copy} onClick={() => void copy(r.inviteUrl)}>
                      {copied === r.inviteUrl ? 'Copied' : 'Copy link'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </form>
      ) : null}
    </section>
  )
}
