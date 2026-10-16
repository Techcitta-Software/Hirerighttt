import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ProfileFormData } from '../data/wizard'
import { candidateFullName, firstName, getInterviewResult, getUser } from '../lib/store'
import { finalizePendingJobApplication, getPendingJob } from '../lib/pendingJobApply'
import { CareerIntelligenceDashboard } from './CareerIntelligenceDashboard'
import styles from './CompleteStep.module.css'

interface CompleteStepProps { data: ProfileFormData; onEditStep: (step: 1 | 2 | 3 | 4) => void }
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
    const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
    const content = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HireRight//AI Interview//EN', 'BEGIN:VEVENT', `UID:${scheduled.getTime()}-interview@hireright.local`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(scheduled)}`, `DTEND:${stamp(new Date(scheduled.getTime() + 15 * 60000))}`, 'SUMMARY:HireRight 15-Minute AI Interview', `URL:${window.location.origin}/interview`, 'DESCRIPTION:Prepare your camera and microphone for your AI interview.', 'BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', 'DESCRIPTION:Your AI interview starts in 15 minutes.', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
    const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'hireright-interview.ics'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <div className={styles.stack}>
    <section className={styles.headerBanner}>
      <div className={styles.successSeal} aria-hidden="true">✓</div>
      <div className={styles.bannerText}><h1>All Set, {name}! 🎉</h1><h2>{scheduled ? 'Your 15-Minute AI Interview is Confirmed!' : 'You’re Ready for Your AI Interview!'}</h2><h3>We’re excited to connect with you and help you take the next step<br className={styles.desktopBreak} /> in your career journey.</h3>{applyNote && <p className={styles.applyNote}>{applyNote}</p>}</div>
      <div role="img" aria-label="Ava, your friendly AI interviewer" className={styles.robotAvatarImg} />
    </section>
    <section className={styles.detailsCard}>
      <h2>Your Interview Details</h2>
      <div className={styles.detailsGrid}><div className={styles.infoList}>
        <div className={styles.infoItem}><Icon kind="calendar" /><div><span>Date</span><strong>{dateText}</strong></div></div>
        <div className={styles.infoItem}><Icon kind="clock" /><div><span>Time</span><strong>{timeText} <small>15 Min Interview</small></strong></div></div>
        <div className={styles.infoItem}><Icon kind="video" /><div><span>Interview Mode</span><strong>AI Video Interview</strong></div></div>
        <div className={styles.infoItem}><Icon kind="info" /><div><span>Interview Type</span><strong>Technical + Behavioral Assessment</strong></div></div>
      </div><div className={styles.nextCard}><h3>What’s Next?</h3><ul><li>Our AI will conduct a fair and personalized conversation to understand you better.</li><li>Showcase your skills, experiences and problem-solving approach.</li><li>Get matched with opportunities that are the right fit for you.</li></ul></div></div>
      <div className={styles.detailsActions}><button className={styles.outlineButton} onClick={downloadCalendar}><Icon kind="calendar" />Add to Calendar</button><button className={styles.primaryButton} onClick={() => setShowGuide(!showGuide)} aria-expanded={showGuide}>View Interview Guide <span>→</span></button></div>
      {showGuide && <div className={styles.guide}><h4>Your interview checklist</h4><p>Choose a quiet, well-lit space. Check your camera, microphone and internet connection. Have examples of your work ready and answer in your own words.</p><div><button onClick={() => onEditStep(4)}>Change interview time</button><button type="button" onClick={() => { const link = localStorage.getItem('hireright.lastInviteUrl'); if (link) window.location.href = link; else navigate('/interview/now') }}>Open interview link →</button></div></div>}
    </section>
    <section className={styles.section}><h2>Your Confirmation Details</h2><h3>Keep your interview details handy with email and WhatsApp.</h3><div className={styles.notifGrid}>
      <article className={styles.emailCard}><header><Icon kind="mail" /><h3>Email Confirmation</h3><span className={styles.previewBadge}>Preview</span></header><p>To: {getUser()?.email || 'Your email address'}</p><p>Subject: Your AI Interview {scheduled ? 'is Confirmed' : 'Details'}</p><div className={styles.message}><p>Hi {name},</p><p>{scheduled ? 'Great news! Your 15-minute AI interview is confirmed.' : 'Your 15-minute AI interview is ready to schedule.'}</p><p>♧ &nbsp;Date: {dateText}<br />◷ &nbsp;Time: {timeText}</p><p>We look forward to meeting you!</p><p>– Team HireRight</p></div><a className={styles.outlineButton} href={`mailto:${encodeURIComponent(getUser()?.email || '')}?subject=${encodeURIComponent('Your AI Interview Details')}&body=${encodeURIComponent(message)}`}>Open Email</a></article>
      <article className={styles.whatsappCard}><header><Icon kind="phone" /><h3>WhatsApp Confirmation</h3><span className={styles.previewBadge}>Preview</span></header><p>Your interview details, ready to share</p><div className={styles.message}><p>Hi {name}! 👋</p><p>Your 15-minute AI interview {scheduled ? 'is confirmed.' : 'is ready to schedule.'}</p><p>🗓 &nbsp;<strong>{dateText}</strong><br />◷ &nbsp;{timeText}</p><p>We’re excited to connect with you and help you<br className={styles.desktopBreak} /> find the right opportunities.</p><p>– Team HireRight</p></div><a className={styles.whatsappButton} href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">Open WhatsApp</a></article>
    </div><p className={styles.deliveryNote}>Message previews only. Open your preferred app to send or save the details.</p></section>
    <section className={styles.section}><h2>Get Ready for Your Interview!</h2><h3>Add the event to your calendar for a 15-minute reminder.</h3><div className={styles.timeline}>
      {([{ icon: 'bell', title: '24 Hours Before', copy: 'Review your experience and prepare a few examples.' }, { icon: 'clock', title: '1 Hour Before', copy: 'Check your camera, microphone and connection.' }, { icon: 'bell', title: '15 Minutes Before', copy: 'Find a quiet space and get ready.' }, { icon: 'video', title: 'Interview Time', copy: 'Join and ace your AI interview!' }] as const).map(item => <div className={styles.timelineItem} key={item.title}><div className={styles.timelineIcon}><Icon kind={item.icon} /></div><div><h3>{item.title}</h3><p>{item.copy}</p></div></div>)}
    </div></section>
    <section className={styles.trophyBanner}><div className={styles.star} aria-hidden="true">⭐</div><div><h2>You’ve Taken the <em>Right Step!</em></h2><h3>Believe in yourself. Showcase your best. Opportunities are waiting for you!</h3><strong>We’re with you, every step of the way.</strong><p className={styles.helpText}>Keep your profile up to date to discover your next opportunity.</p></div><div className={styles.trophy} aria-hidden="true" /></section>
    {interview && <><button className={styles.dossierButton} onClick={() => setShowDossier(!showDossier)} aria-expanded={showDossier}>{showDossier ? 'Hide' : 'View'} Your Career Intelligence Report {showDossier ? '−' : '+'}</button>{showDossier && <CareerIntelligenceDashboard result={interview} candidateName={candidateFullName()} candidateRole={data.currentRole} candidateExperience={data.totalExperience} skills={data.skills} onRetake={() => navigate('/interview')} onContinue={() => navigate('/jobs')} />}</>}
  </div>
}
