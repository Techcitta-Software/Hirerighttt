import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ProfileFormData } from '../data/wizard'
import { fetchMailStatus } from '../lib/api'
import { sendOnboardingConfirmationEmail } from '../lib/scheduleInterviewConfirmation'
import { getInterviewResult, getProfile } from '../lib/store'
import styles from './AiInterviewStep.module.css'

interface AiInterviewStepProps {
  data: ProfileFormData
  onChange: <K extends keyof ProfileFormData>(key: K, value: ProfileFormData[K]) => void
}

const SLOT_GROUPS = [
  ['Morning', ['09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM']],
  ['Afternoon', ['12:00 PM', '12:30 PM', '01:00 PM', '01:30 PM', '02:00 PM', '02:30 PM', '03:00 PM', '03:30 PM', '04:00 PM']],
  ['Evening', ['04:30 PM', '05:00 PM', '05:30 PM', '06:00 PM', '06:30 PM', '07:00 PM']],
] as const

function indiaDay(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date)
  const part = (type: string) => Number(parts.find(item => item.type === type)?.value)
  return new Date(part('year'), part('month') - 1, part('day'))
}
function appointment(date: Date, slot: string) {
  const [time, period] = slot.split(' ')
  const [hour, minute] = time.split(':').map(Number)
  const pad = (value: number) => String(value).padStart(2, '0')
  return new Date(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(hour % 12 + (period === 'PM' ? 12 : 0))}:${pad(minute)}:00+05:30`)
}
function Icon({ kind }: { kind: 'calendar' | 'clock' | 'brain' | 'lock' | 'shield' | 'refresh' | 'check' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'calendar' && <><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M8 3v5m8-5v5M4 11h16" /></>}
    {kind === 'clock' && <><circle cx="12" cy="13" r="8" /><path d="M12 8v5l3 2M5 3 2 6m17-3 3 3M9 2h6" /></>}
    {kind === 'brain' && <><path d="M12 5c-2-4-7-1-6 2-4 0-4 6-1 7-2 4 2 8 5 6l2-2V5Zm0 0c2-4 7-1 6 2 4 0 4 6 1 7 2 4-2 8-5 6l-2-2M8 8l1 3-3 2m10-5-1 3 3 2M8 16l2 1m6-1-2 1" /></>}
    {kind === 'lock' && <><rect x="6" y="10" width="12" height="11" rx="2" /><path d="M9 10V6a3 3 0 0 1 6 0v4m-3 5v2" /></>}
    {kind === 'shield' && <><path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Z" /><path d="m8 11 3 3 5-6" /></>}
    {kind === 'refresh' && <><path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5" /></>}
    {kind === 'check' && <path d="m5 12 4 4L19 6" strokeWidth="3" />}
  </svg>
}

export function AiInterviewStep({ data, onChange }: AiInterviewStepProps) {
  const navigate = useNavigate()
  const today = indiaDay(new Date())
  const [initial] = useState(() => {
    const saved = data.interviewNotes.startsWith('Scheduled: ') ? new Date(data.interviewNotes.slice(11)) : null
    if (saved && !Number.isNaN(saved.getTime()) && saved.getTime() > Date.now()) {
      return { date: indiaDay(saved), slot: saved.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }) }
    }
    return { date: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1), slot: '01:30 PM' }
  })
  const [selectedDate, setSelectedDate] = useState(initial.date)
  const [selectedSlot, setSelectedSlot] = useState(initial.slot)
  const [month, setMonth] = useState(new Date(initial.date.getFullYear(), initial.date.getMonth(), 1))
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [confirmNote, setConfirmNote] = useState('')
  const [inviteUrl, setInviteUrl] = useState('')
  const [smtpReady, setSmtpReady] = useState<boolean | null>(null)
  const scheduledAt = appointment(selectedDate, selectedSlot)
  const scheduled = `Scheduled: ${scheduledAt.toISOString()}`
  useEffect(() => {
    if (data.interviewNotes !== scheduled) onChange('interviewNotes', scheduled)
  }, [data.interviewNotes, onChange, scheduled])

  useEffect(() => {
    void fetchMailStatus().then((s) => setSmtpReady(s.smtpConfigured))
  }, [])
  const firstDay = month.getDay()
  const totalDays = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cellCount = Math.ceil((firstDay + totalDays) / 7) * 7
  const dateLabel = selectedDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const shortLabel = selectedDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })

  function selectDate(date: Date) {
    setSelectedDate(date)
    if (appointment(date, selectedSlot).getTime() <= Date.now()) {
      const nextSlot = SLOT_GROUPS.flatMap(([, slots]) => [...slots]).find(slot => appointment(date, slot).getTime() > Date.now())
      if (nextSlot) setSelectedSlot(nextSlot)
    }
  }
  function launchLiveInterview() {
    const existing = getInterviewResult()
    sessionStorage.setItem('hireright.returnToWizard', '1')
    if (existing) sessionStorage.setItem('hireright.previousScore', String(existing.overall))
    navigate('/interview/now')
  }

  async function confirmSlotAndEmail() {
    if (scheduledAt.getTime() <= Date.now()) {
      setConfirmNote('Pick a future time slot first.')
      return
    }
    setConfirmLoading(true)
    setConfirmNote('')
    try {
      const res = await sendOnboardingConfirmationEmail({ ...data, interviewNotes: scheduled })
      if (res.inviteUrl) setInviteUrl(res.inviteUrl)
      if (res.skipped) {
        setConfirmNote('Confirmation already sent for this slot. Check your inbox or use the link below.')
      } else if (res.emailSent) {
        setConfirmNote('Confirmation email sent. Use your link at the exact slot time to start.')
      } else if (res.emailError) {
        setConfirmNote(`Email failed: ${res.emailError} Use the invite link below.`)
      } else {
        setConfirmNote('Invite created. Copy the link below — email could not be sent.')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not send confirmation.'
      if (msg.toLowerCase().includes('smtp')) {
        setConfirmNote('Gmail SMTP is not configured on the server yet. Set SMTP_EMAIL and SMTP_APP_PASSWORD in .env.')
      } else {
        setConfirmNote(msg)
      }
    } finally {
      setConfirmLoading(false)
    }
  }

  async function copyInviteLink() {
    if (!inviteUrl) return
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setConfirmNote('Interview link copied.')
    } catch {
      window.prompt('Copy your interview link', inviteUrl)
    }
  }

  return <div className={styles.stack}>
    <header className={styles.intro}>
      <span className={styles.calendarIcon}><Icon kind="calendar" /></span>
      <div><h1>{data.resumeFile || getProfile()?.resumeName ? 'Great! Your resume is uploaded successfully! 🎉' : 'Great! Let’s get your AI interview scheduled! 🎉'}</h1><h2>Let&apos;s book your 15-minute AI interview. Choose a time that works best for you.</h2></div>
    </header>
    <section className={styles.benefits} aria-label="Interview benefits">
      <span className={styles.sparkles} aria-hidden="true">✦<small>✦</small></span>
      <div className={styles.benefitCopy}><h2 className={styles.benefitTitle}>Just 15 minutes to open doors to endless opportunities.</h2><h3 className={styles.benefitText}>Our AI interview is designed to understand you better and match you with roles where you can shine.</h3></div>
      <div className={styles.benefitIcons}>
        <div><span><Icon kind="clock" /></span><p>15 Min<br />Interview</p></div>
        <div><span><Icon kind="brain" /></span><p>AI-Powered<br />Assessment</p></div>
        <div><span><Icon kind="lock" /></span><p>Secure &amp;<br />Private</p></div>
      </div>
    </section>
    <section className={styles.bookingSection}>
      <div className={styles.bookingHeading}><h2>4. Select Your 15-Minute Interview Slot</h2><span><Icon kind="clock" /> Interview duration: 15 minutes</span></div>
      <h3 className={styles.timezone}>All times are shown in <span>(IST) Asia/Kolkata</span></h3>
      <div className={styles.bookingGrid}>
        <div className={styles.calendarCol}>
          <div className={styles.calendarNav}><h4>{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h4><div><button type="button" aria-label="Previous month" disabled={month <= new Date(today.getFullYear(), today.getMonth(), 1)} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button><button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button></div></div>
          <div className={styles.weekdaysGrid}>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <span key={day}>{day}</span>)}</div>
          <div className={styles.daysGrid}>{Array.from({ length: cellCount }, (_, index) => {
            const date = new Date(month.getFullYear(), month.getMonth(), index - firstDay + 1)
            const outside = date.getMonth() !== month.getMonth()
            const disabled = outside || appointment(date, '07:00 PM').getTime() <= Date.now()
            const selected = date.getTime() === selectedDate.getTime()
            return <button key={index} type="button" disabled={disabled} aria-label={date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} aria-pressed={selected} className={`${styles.dayCell} ${selected ? styles.daySelected : ''} ${outside ? styles.outside : ''}`} onClick={() => selectDate(date)}><span>{date.getDate()}</span>{!outside && <i className={disabled ? styles.unavailable : styles.available} />}</button>
          })}</div>
          <div className={styles.legend}><span><i className={styles.available} />Available</span><span><i className={styles.limited} />Limited Slots</span><span><i className={styles.unavailable} />Unavailable</span></div>
        </div>
        <div className={styles.slotsCol}><h4>{dateLabel} <span aria-hidden="true">☀️</span></h4>{SLOT_GROUPS.map(([label, slots]) => <div className={styles.slotGroup} key={label}><h5>{label}</h5><div className={styles.slotGrid}>{slots.map(slot => <button type="button" key={slot} disabled={appointment(selectedDate, slot).getTime() <= Date.now()} aria-pressed={selectedSlot === slot} className={`${styles.slotBtn} ${selectedSlot === slot ? styles.slotActive : ''}`} onClick={() => setSelectedSlot(slot)}>{slot}{selectedSlot === slot && <span>✓</span>}</button>)}</div></div>)}</div>
      </div>
    </section>
    <section className={styles.selectedSummary} aria-live="polite">
      <div className={styles.selection}><span className={styles.checkCircle}><Icon kind="check" /></span><div><small>You&apos;ve selected</small><strong>{shortLabel}</strong><p>{selectedSlot} (IST)</p></div></div>
      <div className={styles.assurance}><Icon kind="clock" /><p>You will receive a reminder before your interview</p></div>
      <div className={styles.assurance}><Icon kind="refresh" /><p>Reschedule or change time anytime</p></div>
      <div className={styles.assurance}><Icon kind="shield" /><p>Smooth, secure and distraction-free experience</p></div>
    </section>
    <section className={styles.readyCard}><span className={styles.confetti} aria-hidden="true">🎉</span><div><h2>All Set! You&apos;re Good to Go!</h2><h3>We&apos;re looking forward to your interview.<br />Get ready to showcase <strong>your best</strong> self.</h3></div><span className={styles.readyCheck}><Icon kind="check" /></span></section>
    <section className={styles.actionBar} aria-label="Schedule actions">
      <button
        type="button"
        className={styles.confirmBtn}
        disabled={confirmLoading || scheduledAt.getTime() <= Date.now()}
        onClick={() => void confirmSlotAndEmail()}
      >
        {confirmLoading ? 'Sending…' : 'Confirm slot & email me'}
      </button>
      <button type="button" className={styles.nowBtn} onClick={launchLiveInterview}>
        <span className={styles.nowBtnIcon} aria-hidden="true">▶</span>
        Take interview immediately
      </button>
      {smtpReady === false && (
        <p className={styles.smtpHint}>
          Email delivery needs Gmail SMTP on the server (SMTP_EMAIL and SMTP_APP_PASSWORD in .env).
        </p>
      )}
      {confirmNote && <p className={styles.confirmNote}>{confirmNote}</p>}
      {inviteUrl && (
        <div className={styles.linkRow}>
          <code className={styles.linkPreview}>{inviteUrl}</code>
          <button type="button" className={styles.copyBtn} onClick={() => void copyInviteLink()}>
            Copy link
          </button>
        </div>
      )}
    </section>
  </div>
}
