import { useEffect, useRef, useState } from 'react'
import type { IntegrityLogEvent, InterviewFlagSection, InterviewProctoringSummary } from '../lib/store'
import { apiFetch } from '../lib/api'
import styles from './VideoProctorTimeline.module.css'

type Props = {
  sessionId?: string
  /** Required with sessionId for authorized vendor video review API. */
  candidateEmail?: string
  videoUrl?: string | null
  logs?: IntegrityLogEvent[]
  /** Optional when interview result is already loaded (employer applicant modal). */
  proctoring?: InterviewProctoringSummary | null
  durationSec?: number
}

const clock = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function flagLabel(type: InterviewFlagSection['type']) {
  if (type === 'MULTI_FACE') return 'Multiple people'
  if (type === 'NO_FACE') return 'No face in frame'
  return 'Looking away'
}

export function VideoProctorTimeline({
  sessionId,
  candidateEmail,
  logs = [],
  proctoring: proctoringProp,
  durationSec = 0,
}: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const clipEnd = useRef<number | null>(null)
  const [events, setEvents] = useState(logs)
  const [proctoring, setProctoring] = useState<InterviewProctoringSummary | null>(
    proctoringProp ?? null,
  )
  const [source, setSource] = useState<string | null>(null)
  const [message, setMessage] = useState('No recording available for this interview.')
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(durationSec)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    setProctoring(proctoringProp ?? null)
  }, [proctoringProp])

  useEffect(() => {
    let active = true
    setSource(null)
    setEvents(logs)
    setTime(0)
    setDuration(durationSec)
    if (sessionId && candidateEmail) {
      setMessage('Loading authorized review…')
      const qs = new URLSearchParams({
        sessionId,
        email: candidateEmail,
      })
      void apiFetch(`/api/vendor/interview-review?${qs}`)
        .then(async (r) => {
          if (!r.ok) throw new Error('Video review is restricted to authorized reviewers.')
          return r.json()
        })
        .then((data) => {
          if (!active) return
          setEvents(data.events || [])
          if (data.proctoring) setProctoring(data.proctoring)
          setSource(data.videoUrl)
          setMessage(data.recordingStatus)
        })
        .catch((e) => {
          if (active) setMessage(e instanceof Error ? e.message : 'Could not load review.')
        })
    }
    return () => {
      active = false
    }
  }, [sessionId, candidateEmail, retry, durationSec, logs])

  const flaggedSections = proctoring?.flaggedSections ?? []
  const end = Math.max(
    duration,
    ...events.map((e) => (e.startOffsetSec || 0) + (e.durationSec || 0)),
    ...flaggedSections.map((f) => f.endSec),
    1,
  )

  function seek(sec: number, stop: number | null = null) {
    if (!video.current || !source) return
    clipEnd.current = stop
    video.current.currentTime = Math.max(0, sec)
    void video.current.play().catch(() => setMessage('Press Play to review this section.'))
  }

  return (
    <section className={styles.container} aria-label="Interview video and proctoring review">
      <h3>Interview recording & proctoring</h3>
      <p className={styles.intro}>
        Flagged sections are time ranges where the camera detected sustained looking away, multiple
        people, or an empty frame. They are for recruiter review only and do not change the
        candidate&apos;s interview score.
      </p>

      {proctoring ? (
        <p className={styles.proctorSummary} role="status">
          Proctor integrity: <strong>{proctoring.integrityScore}/100</strong> ·{' '}
          {proctoring.status === 'FLAGGED' ? 'Review recommended' : 'No major flags'} ·{' '}
          {proctoring.counts.total} flagged section{proctoring.counts.total === 1 ? '' : 's'}
        </p>
      ) : null}

      {source ? (
        <video
          ref={video}
          src={source}
          controls
          controlsList="nodownload"
          className={styles.video}
          onError={() => setMessage('Playback unavailable or expired. Reload to retry.')}
          onLoadedMetadata={() => {
            const d = video.current?.duration
            if (d && Number.isFinite(d)) setDuration(d)
          }}
          onTimeUpdate={() => {
            if (!video.current) return
            setTime(video.current.currentTime)
            if (clipEnd.current !== null && video.current.currentTime >= clipEnd.current) {
              video.current.pause()
              clipEnd.current = null
            }
          }}
        />
      ) : (
        <p role="status">{message}</p>
      )}
      {source ? <p role="status">{message}</p> : null}
      {sessionId ? (
        <button type="button" onClick={() => setRetry((n) => n + 1)}>
          Reload recording
        </button>
      ) : null}

      {source && end > 0 ? (
        <div className={styles.timelineBar} aria-hidden={flaggedSections.length === 0}>
          {flaggedSections.map((flag) => {
            const leftPct = Math.min(99, (flag.startSec / end) * 100)
            const widthPct = Math.max(1.2, ((flag.endSec - flag.startSec) / end) * 100)
            const bgColor = flag.type === 'MULTI_FACE' ? '#ef4444' : '#f59e0b'
            return (
              <button
                key={flag.id}
                type="button"
                title={`Turn ${flag.turnIndex}: ${flag.reason}`}
                className={styles.sectionMarker}
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  backgroundColor: bgColor,
                }}
                onClick={() => seek(Math.max(0, flag.startSec - 0.5), flag.endSec + 0.5)}
              />
            )
          })}
        </div>
      ) : null}

      {flaggedSections.length > 0 ? (
        <div className={styles.flagSectionList}>
          <h4>Flagged sections ({flaggedSections.length})</h4>
          <ul>
            {flaggedSections.map((flag) => (
              <li key={flag.id}>
                <button
                  type="button"
                  className={`${styles.flagSectionRow} ${
                    flag.severity === 'high' ? styles.flagHigh : styles.flagMedium
                  }`}
                  onClick={() => seek(Math.max(0, flag.startSec - 0.5), flag.endSec + 0.5)}
                >
                  <span className={styles.flagSectionTitle}>
                    {flagLabel(flag.type)} · Turn #{flag.turnIndex} · {clock(flag.startSec)}–
                    {clock(flag.endSec)} ({flag.durationSec}s)
                  </span>
                  <span className={styles.flagSectionReason}>{flag.reason}</span>
                  {flag.questionText ? (
                    <span className={styles.flagSectionQuestion}>&ldquo;{flag.questionText}&rdquo;</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : proctoring ? (
        <p className={styles.noFlags}>No sustained proctoring flags for this session.</p>
      ) : null}

      {events.length > 0 ? (
        <details className={styles.legacyEvents}>
          <summary>Legacy review events ({events.length})</summary>
          <ol>
            {events.map((e) => (
              <li key={e.id} style={{ marginTop: 12 }}>
                <strong>{e.eventType.replaceAll('_', ' ')}</strong> ·{' '}
                {Number.isFinite(e.startOffsetSec) ? clock(e.startOffsetSec!) : '—'} ·{' '}
                {e.durationSec?.toFixed(1) ?? '?'}s
                <p>{e.message}</p>
                <button
                  type="button"
                  disabled={!source || !Number.isFinite(e.startOffsetSec)}
                  onClick={() =>
                    seek(Math.max(0, e.startOffsetSec! - 2), e.startOffsetSec! + (e.durationSec || 0) + 2)
                  }
                >
                  Review clip
                </button>
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      <p className={styles.playbackClock}>
        {clock(time)} / {clock(end)}
      </p>
    </section>
  )
}
