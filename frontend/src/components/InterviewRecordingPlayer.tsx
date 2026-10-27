import { useCallback, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { IntegrityLogEvent, InterviewFlagSection, InterviewProctoringSummary } from '../lib/store'
import { reviewEventsToFlagSections } from '../lib/reviewEventsToFlagSections'
import styles from './InterviewRecordingPlayer.module.css'

type Props = {
  playbackUrl: string
  events?: IntegrityLogEvent[]
  proctoring?: InterviewProctoringSummary | null
  durationHint?: number | null
  /** Recruiter view: timeline + flag list under the video. */
  employerReview?: boolean
}

function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function flagTypeLabel(type: InterviewFlagSection['type']) {
  if (type === 'MULTI_FACE') return 'Multiple people'
  if (type === 'NO_FACE') return 'No face in frame'
  return 'Looking away'
}

export function InterviewRecordingPlayer({
  playbackUrl,
  events = [],
  proctoring,
  durationHint,
  employerReview = false,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [duration, setDuration] = useState(durationHint && durationHint > 0 ? durationHint : 0)
  const [currentTime, setCurrentTime] = useState(0)

  const flaggedSections = useMemo(() => {
    const fromProctor = proctoring?.flaggedSections ?? []
    if (fromProctor.length) return fromProctor
    if (employerReview && events.length) return reviewEventsToFlagSections(events)
    return []
  }, [proctoring, events, employerReview])

  const flagCount = flaggedSections.length
  const showReviewPanel = employerReview

  const effectiveDuration = useMemo(() => {
    const fromVideo = duration > 0 ? duration : 0
    const fromFlags = flaggedSections.length
      ? Math.max(...flaggedSections.map((f) => f.endSec))
      : 0
    const fromEvents = events
      .filter((e) => typeof e.startOffsetSec === 'number')
      .map((e) => (e.startOffsetSec ?? 0) + (e.durationSec ?? 1))
    const fromEv = fromEvents.length ? Math.max(...fromEvents) : 0
    return Math.max(fromVideo, fromFlags, fromEv, 1)
  }, [duration, flaggedSections, events])

  const seekTo = useCallback(
    (sec: number) => {
      const video = videoRef.current
      if (!video) return
      const t = Math.min(Math.max(0, sec), effectiveDuration)
      video.currentTime = t
      setCurrentTime(t)
      void video.play().catch(() => {})
    },
    [effectiveDuration],
  )

  function onTrackClick(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    seekTo(ratio * effectiveDuration)
  }

  const progressPct = effectiveDuration > 0 ? (currentTime / effectiveDuration) * 100 : 0

  return (
    <div className={styles.wrap}>
      <video
        ref={videoRef}
        className={styles.video}
        controls
        playsInline
        preload="metadata"
        src={playbackUrl}
        onLoadedMetadata={() => {
          const d = videoRef.current?.duration
          if (d && Number.isFinite(d)) setDuration(d)
        }}
        onTimeUpdate={() => {
          const t = videoRef.current?.currentTime
          if (t != null && Number.isFinite(t)) setCurrentTime(t)
        }}
      >
        Your browser does not support video playback.
      </video>

      {showReviewPanel ? (
        <>
          <div className={styles.summaryBar} role="status">
            <span className={styles.summaryCount}>
              {flagCount} proctor flag{flagCount === 1 ? '' : 's'}
            </span>
            {proctoring ? (
              <span className={styles.summaryMeta}>
                Integrity {proctoring.integrityScore}/100 ·{' '}
                {proctoring.status === 'FLAGGED' ? 'Review recommended' : 'Clear'}
              </span>
            ) : flagCount > 0 ? (
              <span className={styles.summaryMeta}>From live camera review events</span>
            ) : (
              <span className={styles.summaryMeta}>No sustained flags recorded</span>
            )}
          </div>

          <div className={styles.timelineLabel}>
            <span>Flagged sections on timeline</span>
            <span className={styles.timelineClock}>
              {formatClock(currentTime)} / {formatClock(effectiveDuration)}
            </span>
          </div>

          <div
            className={styles.timelineTrack}
            role="slider"
            aria-label="Interview timeline with proctoring flags"
            aria-valuemin={0}
            aria-valuemax={Math.round(effectiveDuration)}
            aria-valuenow={Math.round(currentTime)}
            tabIndex={0}
            onClick={onTrackClick}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') seekTo(currentTime + 5)
              if (e.key === 'ArrowLeft') seekTo(currentTime - 5)
            }}
          >
            <div className={styles.timelinePlayed} style={{ width: `${progressPct}%` }} />
            {flaggedSections.map((flag) => {
              const left = (flag.startSec / effectiveDuration) * 100
              const width = Math.max(0.8, ((flag.endSec - flag.startSec) / effectiveDuration) * 100)
              const isHigh = flag.severity === 'high' || flag.type === 'MULTI_FACE'
              return (
                <button
                  key={flag.id}
                  type="button"
                  className={isHigh ? styles.timelineFlagHigh : styles.timelineFlagMedium}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`Turn ${flag.turnIndex}: ${flag.reason}`}
                  aria-label={`${flagTypeLabel(flag.type)} at ${formatClock(flag.startSec)}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    seekTo(Math.max(0, flag.startSec - 0.3))
                  }}
                />
              )
            })}
          </div>

          {flagCount > 0 ? (
            <ul className={styles.flagList}>
              {flaggedSections.map((flag) => (
                <li key={flag.id}>
                  <button
                    type="button"
                    className={styles.flagRow}
                    onClick={() => seekTo(Math.max(0, flag.startSec - 0.3))}
                  >
                    <span
                      className={
                        flag.severity === 'high' || flag.type === 'MULTI_FACE'
                          ? styles.flagDotHigh
                          : styles.flagDotMedium
                      }
                      aria-hidden="true"
                    />
                    <span className={styles.flagTime}>
                      {formatClock(flag.startSec)}–{formatClock(flag.endSec)}
                    </span>
                    <span className={styles.flagMsg}>
                      <strong>{flagTypeLabel(flag.type)}</strong> · Turn #{flag.turnIndex} ·{' '}
                      {flag.reason}
                      {flag.questionText ? (
                        <span className={styles.flagQuestion}> — &ldquo;{flag.questionText}&rdquo;</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.noFlags}>
              No side-glances or multi-person intervals met the review threshold for this session.
            </p>
          )}
        </>
      ) : null}
    </div>
  )
}
