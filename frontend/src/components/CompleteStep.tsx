import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ProfileFormData } from '../data/wizard'
import { candidateFullName, firstName, getInterviewResult, getUser } from '../lib/store'
import { finalizePendingJobApplication, getPendingJob } from '../lib/pendingJobApply'
import { CareerIntelligenceDashboard } from './CareerIntelligenceDashboard'
import styles from './CompleteStep.module.css'

interface CompleteStepProps {
  data: ProfileFormData
  onEditStep: (step: 2 | 3 | 4) => void
}
function Icon({ kind }: { kind: 'calendar' | 'clock' | 'video' | 'info' | 'bell' | 'mail' | 'phone' }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {kind === 'calendar' && <><rect x="3" y="5" width="18" height="17" rx="2" /><path d="M7 2v6m10-6v6M3 11h18M7 15h1m3 0h1m4 0h1M7 18h1m3 0h1" /></>}
    {kind === 'clock' && <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 3" /></>}
    {kind === 'video' && <><rect x="2" y="5" width="14" height="14" rx="2" /><path d="m16 9 6-4v14l-6-4" /></>}
    {kind === 'info' && <><circle cx="12" cy="12" r="10" /><path d="M12 11v6m0-10v.1" /></>}
    {kind === 'bell' && <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4M12 1v1" /></>}
    {kind === 'mail' && <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m2 5 10 8L22 5M2 20l7-7m13 7-7-7" /></>}
    {kind === 'phone' && <><path d="M21 11.5a9 9 0 0 1-13 8L3 21l1.5-5A9 9 0 1 1 21 11.5Z" /><path d="m8 7 2 3-1 1c1 2 2 3 4 3l1-1 3 2c-3 4-11-3-9-8Z" /></>}
  </svg>
}

const TIMELINE = [
  { icon: 'bell', title: '24 hours before', copy: 'Review your experience and prepare a few examples.' },
  { icon: 'clock', title: '1 hour before', copy: 'Check your camera, microphone and connection.' },
  { icon: 'bell', title: '15 minutes before', copy: 'Find a quiet space and get ready.' },
  { icon: 'video', title: 'Interview time', copy: 'Join and ace your AI interview.' },
] as const

export function CompleteStep({ data, onEditStep }: CompleteStepProps) {
  const navigate = useNavigate()
  const name = firstName()
  const interview = getInterviewResult()
  const [showDossier, setShowDossier] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [applyNote, setApplyNote] = useState('')

  useEffect(() => {
    if (!getPendingJob()) return
    void finalizePendingJobApplication()
      .then((ok) => {
        if (ok) setApplyNote('Your job application was submitted with ATS scoring.')
      })
      .catch((err) => {
        setApplyNote(err instanceof Error ? err.message : 'Could not complete job application.')
      })
  }, [])
  const rawSchedule = data.interviewNotes?.startsWith('Scheduled: ') ? data.interviewNotes.slice(11).trim() : ''
  const parsedDate = rawSchedule ? new Date(rawSchedule) : null
  const scheduled = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null
  const dateText = scheduled ? scheduled.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }) : 'Choose your interview date'
  const timeText = scheduled ? `${scheduled.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).toUpperCase()} (IST)` : 'Choose your interview time'
  const message = `Hi ${name},\n\nYour 15-minute AI interview ${scheduled ? 'is scheduled' : 'is ready to schedule'}.\n${scheduled ? `${dateText}\n${timeText}\n` : ''}\nWe look forward to meeting you!\n\n– Team HireRight`
  function downloadCalendar() {
    if (!scheduled) { onEditStep(4); return }
    // The calendar event opens the candidate's own invite link (their slot, their job), not a generic interview.
    const inviteLink = localStorage.getItem('hireright.lastInviteUrl') || `${window.location.origin}/interview`
    const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
    const content = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HireRight//AI Interview//EN', 'BEGIN:VEVENT', `UID:${scheduled.getTime()}-interview@hireright.local`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(scheduled)}`, `DTEND:${stamp(new Date(scheduled.getTime() + 15 * 60000))}`, 'SUMMARY:HireRight 15-Minute AI Interview', `URL:${inviteLink}`, `DESCRIPTION:Join your AI interview: ${inviteLink} — prepare your camera and microphone.`, 'BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', 'DESCRIPTION:Your AI interview starts in 15 minutes.', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
    const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'hireright-interview.ics'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  function openInviteLink() {
    const link = localStorage.getItem('hireright.lastInviteUrl')
    if (link) window.location.href = link
    else navigate('/interview/now')
  }
  const userEmail = getUser()?.email

  return (
    <div className={styles.stack}>
      <section className={styles.headerBanner} aria-labelledby="complete-title">
        <div className={styles.successSeal} aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className={styles.bannerText}>
          <h2 id="complete-title">All set, {name}</h2>
          <p className={styles.bannerLead}>
            {scheduled ? 'Your 15-minute AI interview is confirmed.' : 'You’re ready for your AI interview.'}
          </p>
          <p className={styles.bannerSub}>
            We’re excited to connect with you and help you take the next step in your career journey.
          </p>
          {applyNote && <p className={styles.applyNote} role="status">{applyNote}</p>}
        </div>
        <div role="img" aria-label="Ava, your friendly AI interviewer" className={styles.robotAvatarImg} />
      </section>

      <section className={styles.detailsCard} aria-labelledby="complete-details-title">
        <h2 id="complete-details-title">Your interview details</h2>
        <div className={styles.detailsGrid}>
          <dl className={styles.infoList}>
            <div className={styles.infoItem}>
              <span className={styles.infoIcon}><Icon kind="calendar" /></span>
              <div><dt>Date</dt><dd>{dateText}</dd></div>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.infoIcon}><Icon kind="clock" /></span>
              <div><dt>Time</dt><dd>{timeText} <small className={styles.durationTag}>15 min</small></dd></div>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.infoIcon}><Icon kind="video" /></span>
              <div><dt>Interview mode</dt><dd>AI video interview</dd></div>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.infoIcon}><Icon kind="info" /></span>
              <div><dt>Interview type</dt><dd>Technical and behavioural assessment</dd></div>
            </div>
          </dl>
          <div className={styles.nextCard}>
            <h3>What’s next</h3>
            <ul>
              <li>Our AI will conduct a fair and personalised conversation to understand you better.</li>
              <li>Showcase your skills, experience and problem-solving approach.</li>
              <li>Get matched with opportunities that are the right fit for you.</li>
            </ul>
          </div>
        </div>
        <div className={styles.detailsActions}>
          <button type="button" className={styles.outlineButton} onClick={downloadCalendar}>
            <Icon kind="calendar" />
            Add to calendar
          </button>
          <button type="button" className={styles.outlineButton} onClick={() => setShowGuide(!showGuide)} aria-expanded={showGuide}>
            {showGuide ? 'Hide interview guide' : 'View interview guide'}
          </button>
        </div>
        {showGuide && (
          <div className={styles.guide}>
            <h3>Your interview checklist</h3>
            <p>
              Choose a quiet, well-lit space. Check your camera, microphone and internet connection. Have examples of
              your work ready and answer in your own words.
            </p>
            <div className={styles.guideActions}>
              <button type="button" onClick={() => onEditStep(4)}>Change interview time</button>
              <button type="button" onClick={openInviteLink}>Open interview link</button>
            </div>
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="complete-confirm-title">
        <h2 id="complete-confirm-title">Your confirmation details</h2>
        <p className={styles.sectionSub}>Keep your interview details handy with email and WhatsApp.</p>
        <div className={styles.notifGrid}>
          <article className={styles.channelCard}>
            <header>
              <span className={styles.channelIcon}><Icon kind="mail" /></span>
              <h3>Email confirmation</h3>
              <span className={styles.previewBadge}>Preview</span>
            </header>
            <p className={styles.metaLine}>To: {userEmail || 'Your email address'}</p>
            <p className={styles.metaLine}>Subject: Your AI interview {scheduled ? 'is confirmed' : 'details'}</p>
            <div className={styles.message}>
              <p>Hi {name},</p>
              <p>{scheduled ? 'Great news! Your 15-minute AI interview is confirmed.' : 'Your 15-minute AI interview is ready to schedule.'}</p>
              <p>Date: {dateText}<br />Time: {timeText}</p>
              <p>We look forward to meeting you!</p>
              <p>– Team HireRight</p>
            </div>
            <a
              className={styles.outlineButton}
              href={`mailto:${encodeURIComponent(userEmail || '')}?subject=${encodeURIComponent('Your AI Interview Details')}&body=${encodeURIComponent(message)}`}
            >
              Open email
            </a>
          </article>
          <article className={styles.channelCard}>
            <header>
              <span className={styles.channelIcon}><Icon kind="phone" /></span>
              <h3>WhatsApp confirmation</h3>
              <span className={styles.previewBadge}>Preview</span>
            </header>
            <p className={styles.metaLine}>Your interview details, ready to share</p>
            <div className={styles.message}>
              <p>Hi {name},</p>
              <p>Your 15-minute AI interview {scheduled ? 'is confirmed.' : 'is ready to schedule.'}</p>
              <p><strong>{dateText}</strong><br />{timeText}</p>
              <p>We’re excited to connect with you and help you find the right opportunities.</p>
              <p>– Team HireRight</p>
            </div>
            <a className={styles.outlineButton} href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
              Open WhatsApp
            </a>
          </article>
        </div>
        <p className={styles.deliveryNote}>Message previews only. Open your preferred app to send or save the details.</p>
      </section>

      <section className={styles.section} aria-labelledby="complete-ready-title">
        <h2 id="complete-ready-title">Get ready for your interview</h2>
        <p className={styles.sectionSub}>Add the event to your calendar for a 15-minute reminder.</p>
        <ol className={styles.timeline}>
          {TIMELINE.map((item) => (
            <li className={styles.timelineItem} key={item.title}>
              <span className={styles.timelineIcon}><Icon kind={item.icon} /></span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.trophyBanner} aria-labelledby="complete-encourage-title">
        <h2 id="complete-encourage-title">You’ve taken the right step</h2>
        <p>Believe in yourself and showcase your best. Opportunities are waiting for you.</p>
        <p className={styles.trophyStrong}>We’re with you, every step of the way.</p>
        <p className={styles.helpText}>Keep your profile up to date to discover your next opportunity.</p>
      </section>

      {interview && (
        <>
          <button type="button" className={styles.dossierButton} onClick={() => setShowDossier(!showDossier)} aria-expanded={showDossier}>
            {showDossier ? 'Hide' : 'View'} your career intelligence report
            <svg className={`${styles.dossierChevron} ${showDossier ? styles.dossierChevronOpen : ''}`} viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {showDossier && (
            <CareerIntelligenceDashboard
              embedded
              result={interview}
              candidateName={candidateFullName()}
              candidateRole={data.currentRole}
              candidateExperience={data.totalExperience}
              skills={data.skills}
              onRetake={() => navigate('/interview')}
              onContinue={() => navigate('/jobs')}
            />
          )}
        </>
      )}
    </div>
  )
}
